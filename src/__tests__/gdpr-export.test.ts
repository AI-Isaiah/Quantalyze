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
import { readFileSync } from "node:fs";
import { join } from "node:path";

// gdpr-export.ts imports "server-only" which throws under vitest+jsdom.
// Matches the audit.test.ts and rbac-matrix.test.ts mock pattern.
vi.mock("server-only", () => ({}));

import {
  USER_EXPORT_TABLES,
  collectUserExportBundle,
  encodeExportBundle,
  rowsForTable,
  projectedRowsForTable,
  EXPORT_PER_TABLE_ROW_CAP,
  EXPORT_SIZE_CAP_BYTES,
  EXPORT_PARENT_ID_IN_CHUNK,
  REDACTED_PLACEHOLDER,
  type ExportBundle,
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

  it("NEW-C16-04: positions + position_snapshots are strategy-scoped indirect export entries (not dropped)", () => {
    // Both FK strategy_id NOT NULL -> strategies — the same indirect
    // shape as trades. Pre-fix they were EXCLUDED with a factually-wrong
    // "portfolio-scoped" rationale and a user's live positions +
    // historical snapshots (Art. 15 trading data) were entirely absent.
    for (const table of ["positions", "position_snapshots"] as const) {
      const entry = USER_EXPORT_TABLES.find((t) => t.table === table);
      expect(entry, `${table} missing from USER_EXPORT_TABLES`).toBeDefined();
      expect(entry!.kind).toBe("indirect");
      if (entry!.kind === "indirect") {
        expect(entry!.via_column).toBe("strategy_id");
        expect(entry!.parent_table).toBe("strategies");
        expect(entry!.parent_user_column).toBe("user_id");
      }
    }
  });

  it("NEW-C16-04: positions + position_snapshots are no longer in the coverage-hook EXCLUDED_TABLES", async () => {
    // The CI hook's EXCLUDED_TABLES must NOT still suppress these — a
    // stale exclusion would re-open the gap (the hook can't flag a
    // strategy_id-scoped table on its own; see NEW-C16-06).
    const { EXCLUDED_TABLES } = await import(
      "../../scripts/check-gdpr-export-coverage"
    );
    expect(EXCLUDED_TABLES).not.toHaveProperty("positions");
    expect(EXCLUDED_TABLES).not.toHaveProperty("position_snapshots");
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
            // NEW-C16-02: audit_log_for_user now filters via `.or()`
            // (actor OR entity OR metadata-target) instead of `.eq()`.
            // The mock mirrors `.eq()` so the projected fetch resolves
            // the seeded rows for the source table.
            or: () => ({
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
    const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";
    const rowsByTable: Record<string, unknown[]> = {
      profiles: [{ id: TEST_USER_ID, display_name: "Alice" }],
      api_keys: [{ id: "k1", user_id: TEST_USER_ID }],
      strategies: [{ id: "s1", user_id: TEST_USER_ID }, { id: "s2", user_id: TEST_USER_ID }],
      trades: [{ id: "t1", strategy_id: "s1" }],
      portfolios: [{ id: "p1", user_id: TEST_USER_ID }],
      portfolio_strategies: [{ portfolio_id: "p1", strategy_id: "s1" }],
    };
    const mock = makeMockClient(rowsByTable);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, TEST_USER_ID);

    // Every manifest table should appear in the bundle.
    const bundleTables = bundle.tables.map((t) => t.table);
    for (const spec of USER_EXPORT_TABLES) {
      expect(bundleTables).toContain(spec.table);
    }

    // Schema shape
    expect(bundle.schema_version).toBe(1);
    expect(bundle.user_id).toBe(TEST_USER_ID);
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
    const bundle = await collectUserExportBundle(mock as any, "11111111-1111-1111-1111-111111111111");
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
    const bundle = await collectUserExportBundle(mock as any, "11111111-1111-1111-1111-111111111111");
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

    // M-0011: the `>= 6` assertion above is coupled to the magic 0.95 sizing
    // fudge — if the envelope JSON overhead grows (a new schema_version field,
    // a per-row metadata block), the chosen rowBytes could silently flip the
    // outcome between 5 and 6 rows and the test would flake or quietly weaken.
    // Encode the WHY of binary search instead: the kept prefix must be
    // MAXIMAL — fitting one MORE full row would breach the cap. We derive the
    // per-row serialized cost from the bundle's OWN trimmed rows (not the
    // guessed constant), so this holds regardless of envelope-shape drift.
    const keptRows = trimmedTable!.rows as Array<{ id: string; blob: string }>;
    expect(keptRows.length).toBe(trimmedTable!.row_count);
    // Marginal cost of one more row of the same shape: ", " separator +
    // the JSON-serialized row object. Use the largest kept row as an upper
    // bound so we never UNDER-estimate the marginal cost (which would make
    // the maximality assertion spuriously strict).
    const maxRowCost = Math.max(
      ...keptRows.map(
        (r) => new TextEncoder().encode(JSON.stringify(r) + ",").byteLength,
      ),
    );
    // Adding one more row would push the serialized bundle past the cap
    // (allowing the same 1MB envelope grace the cap-enforcement uses). A
    // halving-only loop that stopped early would leave headroom > maxRowCost
    // and fail this — which is exactly the I3 regression under guard.
    expect(serializedBytes + maxRowCost).toBeGreaterThan(EXPORT_SIZE_CAP_BYTES);
  });

  it("returns zero rows for a user with no data (happy empty path)", async () => {
    const mock = makeMockClient({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "22222222-2222-2222-2222-222222222222");
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

describe("collectUserExportBundle — C-0021 ownership assertion (audit-2026-05-07 security c9)", () => {
  /**
   * Defense-in-depth: this helper runs as service_role and bypasses
   * RLS. A future refactor (admin export wrapper, fan-out worker, CSV
   * aggregator) that wires the helper to an attacker-influenced
   * `userId` would silently exfil any user's full PII bundle. The
   * assertion at function entry hard-refuses non-UUID inputs so the
   * misuse surfaces at the call site rather than as a successful
   * cross-tenant bundle.
   */
  it("throws on empty-string userId (no .eq() filter would scan every row)", async () => {
    const mock = makeMockClient({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectUserExportBundle(mock as any, ""),
    ).rejects.toThrow(/UUID auth\.users\.id/i);
  });

  it("throws on non-UUID userId (e.g., a request-body string or SQL fragment)", async () => {
    const mock = makeMockClient({});
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectUserExportBundle(mock as any, "not-a-uuid"),
    ).rejects.toThrow(/C-0021/);
  });

  it("accepts a valid UUID and proceeds to fetch (regression guard against over-strict regex)", async () => {
    const mock = makeMockClient({});
    const bundle = await collectUserExportBundle(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mock as any,
      "12345678-1234-1234-1234-123456789abc",
    );
    expect(bundle.schema_version).toBe(1);
    expect(bundle.user_id).toBe("12345678-1234-1234-1234-123456789abc");
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
          // NEW-C16-02: audit_log_for_user filters via `.or()`.
          or: () => ({
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
    await collectUserExportBundle(mock as any, "33333333-3333-3333-3333-333333333333");
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
            // NEW-C16-02: audit_log_for_user filters via `.or()`.
            or: () => ({
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
    const bundle = await collectUserExportBundle(mock as any, "44444444-4444-4444-4444-444444444444");

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
            // NEW-C16-02: audit_log_for_user filters via `.or()`.
            or: () => ({
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
    const bundle = await collectUserExportBundle(mock as any, "55555555-5555-5555-5555-555555555555");

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
          // NEW-C16-02: audit_log_for_user filters via `.or()`.
          or: () => ({
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
    const bundle = await collectUserExportBundle(mock as any, "66666666-6666-6666-6666-666666666666");

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
      const bundle = await collectUserExportBundle(mock as any, "77777777-7777-7777-7777-777777777777");
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
            // NEW-C16-02: audit_log_for_user filters via `.or()`.
            or: () => ({
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
    const bundle = await collectUserExportBundle(mock as any, "88888888-8888-8888-8888-888888888888");
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
    // trades, funding_fees, reconciliation_reports, positions,
    // position_snapshots; portfolios parents: portfolio_strategies,
    // portfolio_analytics, portfolio_alerts, allocation_events,
    // weight_snapshots) — each child should reflect the truncation flag
    // for its parent.
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
    const bundle = await collectUserExportBundle(mock as any, "99999999-9999-9999-9999-999999999999");

    // The indirect children (trades, portfolio_strategies, etc.) should
    // all have parent_id_truncated=true.
    const indirectChildren = bundle.tables.filter((t) =>
      [
        "strategy_analytics",
        "trades",
        "funding_fees",
        "reconciliation_reports",
        "positions",
        "position_snapshots",
        // NEW-C16-09: csv_daily_returns is strategy-scoped indirect.
        "csv_daily_returns",
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
    const bundle = await collectUserExportBundle(mock as any, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
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
    const bundle = await collectUserExportBundle(mock as any, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
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
    await collectUserExportBundle(mock as any, "cccccccc-cccc-cccc-cccc-cccccccccccc");

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

describe("collectUserExportBundle — H-0456 / NEW-C16-01 getOrderColumn per-table column (specialist apply, pr-test HIGH conf-9)", () => {
  it("audit_log sorts by created_at; id-less tables sort by their override column; every other table by id", async () => {
    // Spy on `.order(col, ...)` invocations and capture the column
    // passed for each table. The audit_log projected source MUST sort
    // by `created_at` (so size-cap truncation is chronological); the
    // four id-less tables MUST sort by their NOT-NULL override column
    // (NEW-C16-01 — a `.order("id")` against them raises Postgres
    // 42703 and 500s every export); every other table MUST sort by
    // `id` (UUID PK).
    const orderCalls: Array<{ table: string; col: string }> = [];
    // Indirect parent probes (strategies, portfolios) MUST return at
    // least one id so the indirect CHILD select (e.g. portfolio_strategies)
    // actually fires its `.in().order()` — otherwise the child order
    // column would never be exercised and a regression there would
    // slip through. Every other table returns no rows.
    const PARENT_TABLES = new Set(["strategies", "portfolios"]);
    const mock = {
      from: (table: string) => {
        const limit = async () =>
          PARENT_TABLES.has(table)
            ? {
                data: [{ id: "11111111-1111-1111-1111-111111111111" }],
                error: null,
              }
            : { data: [], error: null };
        return {
          select: () => ({
            eq: () => ({
              order: (col: string) => {
                orderCalls.push({ table, col });
                return { limit };
              },
              limit,
            }),
            // NEW-C16-02: audit_log_for_user filters via `.or()` — record
            // its order column the same way so the audit_log assertion
            // (sorts by created_at) still fires.
            or: () => ({
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
    await collectUserExportBundle(mock as any, "dddddddd-dddd-dddd-dddd-dddddddddddd");

    // audit_log (hot) + audit_log_cold (NEW-C16-03 archive) sort by
    // created_at — chronological packing of the size-cap tail.
    const auditTables = new Set(["audit_log", "audit_log_cold"]);
    const auditCalls = orderCalls.filter((c) => auditTables.has(c.table));
    expect(auditCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of auditCalls) expect(c.col).toBe("created_at");

    // NEW-C16-01: the four id-less tables order by their explicit
    // NOT-NULL column — NEVER "id" (which would 42703).
    const idLessOrderColumns: Record<string, string> = {
      user_app_roles: "granted_at",
      user_favorites: "created_at",
      allocator_preferences: "updated_at",
      portfolio_strategies: "added_at",
      allocator_equity_snapshots: "asof",
      // Phase 115.1: allocator_equity_derived PK (allocator_id, kind), no `id`
      // column — orders by `kind` (NOT NULL, unique within an allocator's rows).
      allocator_equity_derived: "kind",
      investor_attestations: "attested_at",
      organization_members: "joined_at",
      // csv_daily_returns is intentionally absent: the Phase 35 per-key-axis
      // migration (20260624120000) gave it a surrogate `id` PK, so it now
      // falls into the "every remaining table sorts by 'id'" assertion below.
    };
    for (const [table, expectedCol] of Object.entries(idLessOrderColumns)) {
      const calls = orderCalls.filter((c) => c.table === table);
      expect(calls.length).toBeGreaterThanOrEqual(1);
      for (const c of calls) expect(c.col).toBe(expectedCol);
    }

    // Every remaining table (has a UUID PK) sorts by 'id'.
    const idLessTables = new Set(Object.keys(idLessOrderColumns));
    const idTables = orderCalls.filter(
      (c) => !auditTables.has(c.table) && !idLessTables.has(c.table),
    );
    expect(idTables.length).toBeGreaterThan(0);
    for (const c of idTables) expect(c.col).toBe("id");
  });
});

describe("collectUserExportBundle — NEW-C16-02 audit_log widened to entity/metadata-target rows (HIGH)", () => {
  it("fetches audit_log via `.or()` covering actor + entity + metadata-target, not a bare `.eq()`", async () => {
    // Pre-fix the audit_log_for_user source SELECT used
    // `.eq("user_id", subject)`, so admin-on-subject rows (user_id=ADMIN,
    // entity_id=subject) were never fetched and silently absent from the
    // export despite the projection being entitled to keep them. The fix
    // widens the SQL predicate to MATCH redactAuditLogForUser's retention
    // criteria. This test pins that audit_log is queried through `.or()`
    // (NOT `.eq()`) and that the filter string covers all three
    // directions.
    const SUBJECT = "55555555-5555-5555-5555-555555555555";
    const ADMIN = "99999999-9999-9999-9999-999999999999";
    // The admin-on-subject row: actor is the ADMIN, the subject is the
    // ENTITY. A bare `.eq("user_id", subject)` would NEVER return it.
    const adminOnSubjectRow = {
      id: "audit-1",
      user_id: ADMIN,
      action: "role.grant",
      entity_type: "user",
      entity_id: SUBJECT,
      metadata: { granted_by: ADMIN, role: "allocator" },
      created_at: "2026-05-01T00:00:00Z",
    };

    let auditOrFilter: string | null = null;
    let auditUsedEq = false;
    const mock = {
      from: (table: string) => {
        const empty = async () => ({ data: [], error: null });
        const auditRows = async () => ({
          data: [adminOnSubjectRow],
          error: null,
        });
        return {
          select: () => ({
            eq: () => {
              if (table === "audit_log") auditUsedEq = true;
              return {
                order: () => ({ limit: empty }),
                limit: empty,
              };
            },
            or: (filter: string) => {
              if (table === "audit_log") auditOrFilter = filter;
              return {
                order: () => ({
                  limit: table === "audit_log" ? auditRows : empty,
                }),
                limit: table === "audit_log" ? auditRows : empty,
              };
            },
            in: () => ({
              order: () => ({ limit: empty }),
              limit: empty,
            }),
          }),
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, SUBJECT);

    // The audit_log source MUST be queried via `.or()`, never the
    // actor-only `.eq()`.
    expect(auditUsedEq).toBe(false);
    expect(auditOrFilter).not.toBeNull();
    // The `.or()` filter covers all three retention directions.
    expect(auditOrFilter).toContain(`user_id.eq.${SUBJECT}`);
    expect(auditOrFilter).toContain(
      `and(entity_id.eq.${SUBJECT},entity_type.eq.user)`,
    );
    expect(auditOrFilter).toContain(
      `metadata->>target_user_id.eq.${SUBJECT}`,
    );

    // The admin-on-subject row reaches the projection and is exported.
    const auditTable = bundle.tables.find(
      (t) => t.table === "audit_log_for_user",
    );
    expect(auditTable).toBeDefined();
    expect(auditTable!.row_count).toBe(1);
    const row = auditTable!.rows[0] as Record<string, unknown>;
    expect(row.id).toBe("audit-1");
    expect(row.entity_id).toBe(SUBJECT);
    // Entity-only retention scrubs the cross-party actor user_id and the
    // admin UUID in metadata (existing redaction contract, NEW-C16-02
    // does not weaken it).
    expect(row.user_id).toBe(REDACTED_PLACEHOLDER);
    expect((row.metadata as Record<string, unknown>).granted_by).toBe(
      REDACTED_PLACEHOLDER,
    );
  });
});

describe("collectUserExportBundle — NEW-C16-03 audit_log_cold archive is exported (HIGH)", () => {
  it("manifest projects audit_log_cold via the same redactor + entity/metadata widening", () => {
    const cold = USER_EXPORT_TABLES.find(
      (t) => t.kind === "projected" && t.source_table === "audit_log_cold",
    );
    expect(cold, "audit_log_cold not in USER_EXPORT_TABLES").toBeDefined();
    if (cold && cold.kind === "projected") {
      // Distinct bundle name so it does not collide with the hot
      // projection.
      expect(cold.table).toBe("audit_log_cold_for_user");
      expect(cold.user_column).toBe("user_id");
      // Same redactor as hot — cross-party PII scrub is identical.
      expect(cold.project).toBe(
        (
          USER_EXPORT_TABLES.find(
            (t) => t.kind === "projected" && t.source_table === "audit_log",
          ) as { project: unknown }
        ).project,
      );
      // Same entity/metadata-target widening (NEW-C16-02) so old
      // admin-on-subject rows in the archive are not silently dropped.
      expect(typeof cold.or_filter).toBe("function");
      const filter = cold.or_filter!("abc");
      expect(filter).toContain("user_id.eq.abc");
      expect(filter).toContain("and(entity_id.eq.abc,entity_type.eq.user)");
      expect(filter).toContain("metadata->>target_user_id.eq.abc");
    }
  });

  it("an archived (cold) row reaches the bundle as audit_log_cold_for_user", async () => {
    // Pre-fix the export read ONLY the hot table, so an account >2yr old
    // received a bundle missing its oldest (most forensically-relevant)
    // entries with no `partial` signal. This drives a mock whose
    // audit_log_cold source returns one archived row and asserts it lands.
    const SUBJECT = "77777777-7777-7777-7777-777777777777";
    const coldRow = {
      id: "cold-1",
      user_id: SUBJECT,
      action: "role.grant",
      entity_type: "strategy",
      entity_id: "strat-9",
      metadata: { role: "manager" },
      created_at: "2023-01-01T00:00:00Z",
    };
    const mock = {
      from: (table: string) => {
        const empty = async () => ({ data: [], error: null });
        const coldRows = async () => ({ data: [coldRow], error: null });
        const resolver = table === "audit_log_cold" ? coldRows : empty;
        return {
          select: () => ({
            eq: () => ({ order: () => ({ limit: empty }), limit: empty }),
            or: () => ({
              order: () => ({ limit: resolver }),
              limit: resolver,
            }),
            in: () => ({ order: () => ({ limit: empty }), limit: empty }),
          }),
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, SUBJECT);
    const coldTable = bundle.tables.find(
      (t) => t.table === "audit_log_cold_for_user",
    );
    expect(coldTable, "audit_log_cold_for_user absent from bundle").toBeDefined();
    expect(coldTable!.row_count).toBe(1);
    const out = coldTable!.rows[0] as Record<string, unknown>;
    expect(out.id).toBe("cold-1");
    // Subject is the actor here, so user_id is preserved (own data).
    expect(out.user_id).toBe(SUBJECT);
    expect(bundle.partial).toBe(false);
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

/**
 * Audit 2026-05-07 red-team #4 (HIGH conf-8): direct unit tests of
 * `encodeExportBundle` byte output. Pre-fix the function had no
 * round-trip test — the route test mocked it out entirely with a
 * tautological `TextEncoder().encode(JSON.stringify(bundle))` stub.
 * Any of (a) wrong field order, (b) missing comma between rows,
 * (c) undefined-field corruption (red-team #8), or (d) divergence
 * between cached and fallback paths could ship malformed JSON to
 * storage with no test failure.
 *
 * These tests assert the hand-rolled streaming serializer is
 * load-bearing-correct.
 */
describe("encodeExportBundle — direct unit tests (red-team #4)", () => {
  function makeMinimalBundle(): ExportBundle {
    return {
      schema_version: 1,
      user_id: "user-encode-1",
      generated_at: "2026-04-16T00:00:00.000Z",
      total_row_count: 2,
      tables: [
        {
          table: "profiles",
          rows: [{ id: "user-encode-1", display_name: "Alice" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
        {
          table: "api_keys",
          rows: [{ id: "k1", exchange: "binance", label: "main" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    };
  }

  it("produces JSON that JSON.parse round-trips structurally (fallback path)", () => {
    // Hand-constructed bundle does NOT populate the WeakMap row cache,
    // exercising the fallback `JSON.stringify(t.rows[r])` branch.
    const b = makeMinimalBundle();
    const bytes = encodeExportBundle(b);
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text);
    // Structural equivalence to JSON.stringify(b) — drops undefined
    // values (which encodeExportBundle now coerces to JSON null via
    // safeStringify, but the bundle as constructed has no undefined).
    expect(parsed).toEqual(JSON.parse(JSON.stringify(b)));
  });

  it("matches JSON.stringify(bundle) byte-for-byte on a representative bundle", () => {
    const b = makeMinimalBundle();
    const ours = new TextDecoder().decode(encodeExportBundle(b));
    const ref = JSON.stringify(b);
    expect(ours).toBe(ref);
  });

  it("emits no inter-row commas on a single-row table; emits one comma per gap on multi-row", () => {
    const b: ExportBundle = {
      ...makeMinimalBundle(),
      tables: [
        {
          table: "user_notes",
          rows: [{ id: "n1" }, { id: "n2" }, { id: "n3" }],
          row_count: 3,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      total_row_count: 3,
    };
    const text = new TextDecoder().decode(encodeExportBundle(b));
    const parsed = JSON.parse(text);
    expect(parsed.tables[0].rows).toEqual([
      { id: "n1" },
      { id: "n2" },
      { id: "n3" },
    ]);
    // Count commas in the rows array (the body between `"rows":[` and
    // `]`). With three single-key rows we expect exactly 2 inter-row
    // commas plus the commas inside the {...} objects.
    const rowsBody = text.match(/"rows":\[([^\]]+)\]/);
    expect(rowsBody).toBeTruthy();
    const innerCommas = (rowsBody![1].match(/\},\{/g) ?? []).length;
    expect(innerCommas).toBe(2);
  });

  it("handles an empty rows array (no inter-row commas at all)", () => {
    const b: ExportBundle = {
      ...makeMinimalBundle(),
      tables: [
        {
          table: "user_notes",
          rows: [],
          row_count: 0,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
      total_row_count: 0,
    };
    const text = new TextDecoder().decode(encodeExportBundle(b));
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(b)));
    expect(text).toContain('"rows":[]');
  });

  it("red-team #8: undefined envelope/wrapper fields are coerced to JSON null (not the literal 'undefined')", () => {
    // Hand-construct a bundle with an undefined field via a manual
    // type override. JSON.stringify(undefined) returns the JS value
    // undefined; concatenated into a template literal it becomes
    // the unquoted 4 characters 'undefined' which JSON.parse rejects.
    // safeStringify coerces this to "null".
    const b = {
      ...makeMinimalBundle(),
      tables: [
        {
          table: "user_notes",
          rows: [{ id: "n1" }],
          row_count: 1,
          truncated_at_cap: false,
          parent_id_truncated: false,
          // fetch_error is normally string | null; an undefined here
          // would have shipped the literal 'undefined' pre-fix.
          fetch_error: undefined as unknown as string | null,
        },
      ],
    };
    const text = new TextDecoder().decode(
      encodeExportBundle(b as ExportBundle),
    );
    // Wire encoding parses cleanly — no 'undefined' literal slipped
    // through.
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.tables[0].fetch_error).toBeNull();
    expect(text).not.toMatch(/:undefined[,}]/);
  });

  it("red-team #8: a sparse-array row slot coerces to JSON null in the fallback path", () => {
    // The fallback (no WeakMap cache) path iterates t.rows[r] directly.
    // A sparse-array slot returns undefined; safeStringify on that
    // returns "null" — wire encoding parses cleanly.
    const sparse: unknown[] = [{ id: "r1" }];
    // Sparse hole at index 1.
    (sparse as unknown[]).length = 2;
    const b: ExportBundle = {
      ...makeMinimalBundle(),
      tables: [
        {
          table: "user_notes",
          rows: sparse,
          row_count: sparse.length,
          truncated_at_cap: false,
          parent_id_truncated: false,
          fetch_error: null,
        },
      ],
    };
    const text = new TextDecoder().decode(encodeExportBundle(b));
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(parsed.tables[0].rows[0]).toEqual({ id: "r1" });
    expect(parsed.tables[0].rows[1]).toBeNull();
  });

  it("WeakMap cached path and fallback path produce identical bytes for the same bundle", async () => {
    // Drive collectUserExportBundle so the WeakMap is populated for
    // one bundle; then construct a structurally identical bundle by
    // hand (no cache) and assert bytes match.
    const rows = [{ id: "row-a", label: "x" }, { id: "row-b", label: "y" }];
    const emptyLimit = async () => ({ data: [], error: null });
    const userNotesLimit = async () => ({ data: rows, error: null });
    const mock = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: table === "user_notes" ? userNotesLimit : emptyLimit,
            }),
            limit: table === "user_notes" ? userNotesLimit : emptyLimit,
          }),
          in: () => ({
            order: () => ({ limit: emptyLimit }),
            limit: emptyLimit,
          }),
        }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cachedBundle = await collectUserExportBundle(mock as any, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    const cachedBytes = encodeExportBundle(cachedBundle);
    const cachedText = new TextDecoder().decode(cachedBytes);
    // Sanity: cached path produces parseable JSON that round-trips.
    expect(JSON.parse(cachedText)).toEqual(
      JSON.parse(JSON.stringify(cachedBundle)),
    );

    // Hand-construct an equivalent bundle (no WeakMap entry — fallback
    // path will fire) and verify the bytes match.
    const handBundle: ExportBundle = JSON.parse(JSON.stringify(cachedBundle));
    const handBytes = encodeExportBundle(handBundle);
    const handText = new TextDecoder().decode(handBytes);
    expect(handText).toBe(cachedText);
  });

  it("red-team #5: a post-collect mutation of cached rows throws (strict-mode freeze)", async () => {
    // collectUserExportBundle freezes each cached row + the includedRows
    // array. A post-collect mutation must throw, surfacing the cache-
    // staleness invariant violation BEFORE encodeExportBundle ships
    // pre-mutation bytes.
    const rows = [{ id: "row-mut", field: "before" }];
    const limit = async () => ({ data: rows, error: null });
    const emptyLimit = async () => ({ data: [], error: null });
    const mock = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: table === "user_notes" ? limit : emptyLimit,
            }),
            limit: table === "user_notes" ? limit : emptyLimit,
          }),
          in: () => ({
            order: () => ({ limit: emptyLimit }),
            limit: emptyLimit,
          }),
        }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "ffffffff-ffff-ffff-ffff-ffffffffffff");
    const notes = bundle.tables.find((t) => t.table === "user_notes");
    expect(notes).toBeDefined();
    expect(notes!.rows.length).toBe(1);
    const row = notes!.rows[0] as Record<string, unknown>;
    // Mutation MUST throw in strict mode (which all ES modules use).
    expect(() => {
      row.field = "mutated";
    }).toThrow();
    // Length-mutation on the rows array MUST also throw.
    expect(() => {
      (notes!.rows as unknown[]).push({ id: "row-injected" });
    }).toThrow();
  });
});

/**
 * Audit 2026-05-07 red-team #6 (HIGH conf-7): top-level
 * `row.user_id` on entity / metadata-target retained rows is the
 * ACTOR's id (typically an admin) — a cross-party identifier.
 * Pin redactAuditLogForUser scrubs it.
 */
describe("redactAuditLogForUser — top-level user_id scrubbed on entity/meta-target retention (red-team #6)", () => {
  it("blanks row.user_id when subject is retained ONLY because they're the entity (admin grant)", async () => {
    const { redactAuditLogForUser, REDACTED_PLACEHOLDER } = await import(
      "@/lib/gdpr-export"
    );
    const out = redactAuditLogForUser(
      [
        // Admin-actor grants role to subject. user_id is the admin.
        {
          id: "g1",
          user_id: "admin-uuid-A",
          action: "role.grant",
          entity_type: "user",
          entity_id: "subject-id",
          metadata: { role: "allocator" },
        },
      ],
      "subject-id",
    );
    expect(out).toHaveLength(1);
    expect(out[0].user_id).toBe(REDACTED_PLACEHOLDER);
    // The audit info the subject IS entitled to: action, the role.
    expect(out[0].action).toBe("role.grant");
    expect((out[0].metadata as Record<string, unknown>).role).toBe("allocator");
  });

  it("blanks row.user_id when subject is retained ONLY because metadata.target_user_id matches (admin sanitize)", async () => {
    const { redactAuditLogForUser, REDACTED_PLACEHOLDER } = await import(
      "@/lib/gdpr-export"
    );
    const out = redactAuditLogForUser(
      [
        {
          id: "s1",
          user_id: "admin-uuid-B",
          action: "account.sanitize",
          entity_type: "system",
          entity_id: null,
          metadata: { target_user_id: "subject-id", reason: "user_request" },
        },
      ],
      "subject-id",
    );
    expect(out).toHaveLength(1);
    expect(out[0].user_id).toBe(REDACTED_PLACEHOLDER);
  });

  it("KEEPS row.user_id when subject is the actor (they're entitled to know they acted)", async () => {
    const { redactAuditLogForUser } = await import("@/lib/gdpr-export");
    const out = redactAuditLogForUser(
      [
        {
          id: "a1",
          user_id: "subject-id",
          action: "api_key.create",
          metadata: { exchange: "binance" },
        },
      ],
      "subject-id",
    );
    expect(out).toHaveLength(1);
    expect(out[0].user_id).toBe("subject-id");
  });

  it("blanks row.user_id on admin.kill_switch when subject is entity but not actor", async () => {
    const { redactAuditLogForUser, REDACTED_PLACEHOLDER } = await import(
      "@/lib/gdpr-export"
    );
    const out = redactAuditLogForUser(
      [
        {
          id: "ks1",
          user_id: "admin-uuid-C",
          action: "admin.kill_switch",
          entity_type: "user",
          entity_id: "subject-id",
          metadata: { reason: "compliance_hold" },
        },
      ],
      "subject-id",
    );
    expect(out).toHaveLength(1);
    expect(out[0].user_id).toBe(REDACTED_PLACEHOLDER);
  });
});

/**
 * Audit 2026-05-07 red-team #3 (HIGH conf-8): null parent ids are
 * legitimate dropped rows, not a fatal type mismatch. The bundle
 * should still build with only the affected child rows missing.
 */
describe("collectUserExportBundle — indirect null parent IDs are tolerated (red-team #3)", () => {
  it("NEW-C16-08: a null parent id does NOT fetch_error, but DOES mark the child table parent_id_null_dropped (incomplete, not silently complete)", async () => {
    // Strategies parent returns one row with id=null among real rows.
    // Pre-fix (red-team #3) this triggered fail-loud and refused the export;
    // then the over-correction shipped the bundle as COMPLETE (partial:false,
    // no signal) even though child rows of the null-keyed parent are absent.
    // NEW-C16-08: keep the no-lockout property (no fetch_error / partial), but
    // surface parent_id_null_dropped_tables so the route refuses to ship it as
    // a complete Art. 15 export.
    const parentRowsWithNull = [
      { id: "s-1" },
      { id: null },
      { id: "s-2" },
    ];
    const childRows = [{ id: "t-1", strategy_id: "s-1" }];
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({
          data: parentRowsWithNull,
          error: null,
        });
        const childLimit = async () => ({ data: childRows, error: null });
        const emptyLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              // NEW-C16-02: audit_log_for_user filters via `.or()`.
              or: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: () => ({
                order: () => ({
                  limit: table === "trades" ? childLimit : emptyLimit,
                }),
                limit: table === "trades" ? childLimit : emptyLimit,
              }),
            };
          },
        };
      },
    };
    // Silence the expected console.warn — the null drop is logged
    // but does NOT fail the bundle.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "12121212-1212-1212-1212-121212121212");
    consoleWarnSpy.mockRestore();

    // No hard failure (red-team #3 contract preserved): not partial, no
    // fetch_error, the trades row that DID resolve is present.
    expect(bundle.partial).toBe(false);
    expect(bundle.failed_tables).toEqual([]);
    const tradesEntry = bundle.tables.find((t) => t.table === "trades");
    expect(tradesEntry).toBeDefined();
    expect(tradesEntry!.fetch_error).toBeNull();
    expect(tradesEntry!.row_count).toBe(1);
    // NEW-C16-08: but the dropped null parent IS surfaced so the bundle is
    // honestly incomplete (the route refuses to mint a signed URL on this).
    // Fails without the fix: pre-fix parent_id_null_dropped_tables was always [].
    expect(bundle.parent_id_null_dropped_tables).toContain("trades");
  });

  it("a non-null, non-string parent id STILL triggers fetch_error (bigint/composite case)", async () => {
    const parentRows = [{ id: 42 as unknown as string }];
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({ data: parentRows, error: null });
        const emptyLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: () => ({
                order: () => ({ limit: emptyLimit }),
                limit: emptyLimit,
              }),
            };
          },
        };
      },
    };
    const consoleErrSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "13131313-1313-1313-1313-131313131313");
    consoleErrSpy.mockRestore();
    const tradesEntry = bundle.tables.find((t) => t.table === "trades");
    expect(tradesEntry!.fetch_error).toBeTruthy();
    expect(tradesEntry!.fetch_error).toMatch(/type mismatch/);
    expect(bundle.partial).toBe(true);
  });
});

/**
 * Audit 2026-05-07 red-team #12 (MED conf-8 chain): when fetch_error
 * fires on an indirect child fetch, parent_id_truncated MUST be
 * cleared so forensic readers see ONE cause per failed table.
 */
describe("collectUserExportBundle — fetch_error suppresses parent_id_truncated (red-team #12)", () => {
  it("indirect child SELECT error clears parent_id_truncated on the failed payload", async () => {
    // Parent probe returns >= cap rows (truncated=true). The child
    // fetch then errors.
    const saturatedParents = Array.from({ length: 2000 }, (_, i) => ({
      id: `p-${i}`,
    }));
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({
          data: saturatedParents,
          error: null,
        });
        const childErr = async () => ({
          data: null,
          error: { code: "57014", message: "child timeout" },
        });
        const emptyLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: () => ({
                order: () => ({
                  limit: table === "trades" ? childErr : emptyLimit,
                }),
                limit: table === "trades" ? childErr : emptyLimit,
              }),
            };
          },
        };
      },
    };
    const consoleErrSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "14141414-1414-1414-1414-141414141414");
    consoleErrSpy.mockRestore();
    const tradesEntry = bundle.tables.find((t) => t.table === "trades");
    expect(tradesEntry).toBeDefined();
    expect(tradesEntry!.fetch_error).toBeTruthy();
    // The double-signal is the bug: pre-fix this was TRUE; fix asserts
    // FALSE because the parent-id cap is meaningless when the child
    // never fetched any of those ids.
    expect(tradesEntry!.parent_id_truncated).toBe(false);
    expect(bundle.partial).toBe(true);
    expect(bundle.failed_tables).toContain("trades");
    // The bundle-level parent_id_truncated_tables list MUST NOT
    // include the errored-and-cleared table.
    expect(bundle.parent_id_truncated_tables).not.toContain("trades");
  });
});

/**
 * Audit 2026-05-07 red-team #10 (MED conf-8): the indirect child
 * SELECT chunks .in() at EXPORT_PARENT_ID_IN_CHUNK so the URL stays
 * under common edge-proxy limits.
 */
describe("collectUserExportBundle — chunked indirect IN under proxy limits (red-team #10)", () => {
  it("EXPORT_PARENT_ID_IN_CHUNK is <= 500 (keeps URL under ~18KB for UUID args)", () => {
    expect(EXPORT_PARENT_ID_IN_CHUNK).toBeLessThanOrEqual(500);
    expect(EXPORT_PARENT_ID_IN_CHUNK).toBeGreaterThanOrEqual(100);
  });

  it("fans out across multiple .in() SELECTs for > 1000 parent IDs", async () => {
    // Capture every `.in(col, ids)` call across the indirect child
    // SELECTs. With 1200 parent ids and chunk=500, the child SELECT
    // for `trades` should fire 3 times (500 + 500 + 200).
    const parentRows = Array.from({ length: 1200 }, (_, i) => ({
      id: `s-${i}`,
    }));
    const childRows = [{ id: "t-1", strategy_id: "s-0" }];
    const inCalls: number[] = [];
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({ data: parentRows, error: null });
        const childLimit = async () => ({ data: childRows, error: null });
        const emptyLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: (_col: string, ids: unknown[]) => {
                if (table === "trades") {
                  inCalls.push(ids.length);
                }
                return {
                  order: () => ({
                    limit: table === "trades" ? childLimit : emptyLimit,
                  }),
                  limit: table === "trades" ? childLimit : emptyLimit,
                };
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await collectUserExportBundle(mock as any, "15151515-1515-1515-1515-151515151515");

    // Verify chunking happened
    expect(inCalls.length).toBeGreaterThan(1);
    // Every chunk must be <= EXPORT_PARENT_ID_IN_CHUNK (500)
    for (const n of inCalls) {
      expect(n).toBeLessThanOrEqual(EXPORT_PARENT_ID_IN_CHUNK);
    }
    // Total ids processed must reflect every parent (1200)
    const total = inCalls.reduce((s, n) => s + n, 0);
    expect(total).toBe(1200);
  });

  it("NEW-C16-07: multi-chunk indirect fetch is globally sorted post-collection, not chunk-ordered", async () => {
    // Scenario: 2 chunks of parent IDs. Chunk 1 (parents p-0..p-499) returns
    // child rows with id/orderCol values "t-Z" (lexically LAST). Chunk 2
    // (parents p-500..p-999) returns child rows with id "t-A" (lexically
    // FIRST). Pre-fix the cap sliced the concatenation — chunk 1 rows all had
    // a high orderCol so if the cap was hit, chunk 1 rows (which come first in
    // the concatenation) would survive while chunk 2 rows (t-A, which are
    // globally older) would be dropped. The fix sorts globally BEFORE capping.
    //
    // We seed 3 rows from chunk 1 (id: t-Z2, t-Z1, t-Z0 — lexically late)
    // and 3 from chunk 2 (id: t-A2, t-A1, t-A0 — lexically early). Global
    // sort ascending should order t-A0 < t-A1 < t-A2 < t-Z0 < t-Z1 < t-Z2.

    const chunk1ParentRows = Array.from({ length: EXPORT_PARENT_ID_IN_CHUNK }, (_, i) => ({
      id: `p-${i}`,
    }));
    const chunk2ParentRows = Array.from({ length: 3 }, (_, i) => ({
      id: `p-${EXPORT_PARENT_ID_IN_CHUNK + i}`,
    }));
    const allParentRows = [...chunk1ParentRows, ...chunk2ParentRows];

    // Chunk 1 children — lexically LAST orderCol values
    const chunk1Children = [
      { id: "t-Z2", strategy_id: "p-0" },
      { id: "t-Z1", strategy_id: "p-1" },
      { id: "t-Z0", strategy_id: "p-2" },
    ];
    // Chunk 2 children — lexically FIRST orderCol values
    const chunk2Children = [
      { id: "t-A2", strategy_id: `p-${EXPORT_PARENT_ID_IN_CHUNK}` },
      { id: "t-A1", strategy_id: `p-${EXPORT_PARENT_ID_IN_CHUNK + 1}` },
      { id: "t-A0", strategy_id: `p-${EXPORT_PARENT_ID_IN_CHUNK + 2}` },
    ];

    // Separate counter per table so other indirect tables don't interfere.
    const tradesInCallCount = { v: 0 };
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({ data: allParentRows, error: null });
        const emptyLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: (_col: string, _ids: unknown[]) => {
                if (table !== "trades") {
                  return {
                    order: () => ({ limit: emptyLimit }),
                    limit: emptyLimit,
                  };
                }
                const chunkIdx = tradesInCallCount.v++;
                const rows = chunkIdx === 0 ? chunk1Children : chunk2Children;
                return {
                  order: () => ({
                    limit: async () => ({ data: rows, error: null }),
                  }),
                  limit: async () => ({ data: rows, error: null }),
                };
              },
            };
          },
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "17171717-1717-1717-1717-171717171717");

    const tradesEntry = bundle.tables.find((t) => t.table === "trades");
    expect(tradesEntry).toBeDefined();
    // All 6 rows must be present (well under the cap).
    expect(tradesEntry!.row_count).toBe(6);
    const ids = (tradesEntry!.rows as Array<{ id: string }>).map((r) => r.id);
    // Global sort: t-A0, t-A1, t-A2 come before t-Z0, t-Z1, t-Z2.
    // Without the fix, the order would be t-Z2, t-Z1, t-Z0, t-A2, t-A1, t-A0
    // (chunk 1 first, then chunk 2).
    expect(ids).toEqual(["t-A0", "t-A1", "t-A2", "t-Z0", "t-Z1", "t-Z2"]);
  });

  it("NEW-C16-10: indirect fetch stops accumulating after the first chunk that exceeds the cap (memory bound)", async () => {
    // Red-team M conf=9: the original NEW-C16-07 fix fetched
    // EXPORT_PER_TABLE_ROW_CAP rows PER chunk (no early exit), accumulating
    // up to 4 × 50K rows in the heap before the post-sort splice truncated.
    // The fix breaks out of the chunk loop as soon as aggregated.length >
    // EXPORT_PER_TABLE_ROW_CAP, bounding memory to cap + one chunk's rows.
    //
    // This test verifies that when chunk 1 already returns > cap rows,
    // chunk 2 is NOT fetched (the mock tracks which chunks were called).

    // 2 chunks of parents
    const chunk1Parents = Array.from({ length: EXPORT_PARENT_ID_IN_CHUNK }, (_, i) => ({
      id: `q-${i}`,
    }));
    const chunk2Parents = [{ id: `q-${EXPORT_PARENT_ID_IN_CHUNK}` }];
    const allParents = [...chunk1Parents, ...chunk2Parents];

    // Chunk 1 returns cap + 1 rows — triggers early-exit.
    const cap = EXPORT_PER_TABLE_ROW_CAP;
    const chunk1Children = Array.from({ length: cap + 1 }, (_, i) => ({
      id: `r-${String(i).padStart(6, "0")}`,
      strategy_id: `q-${i % EXPORT_PARENT_ID_IN_CHUNK}`,
    }));
    const chunk2Children = [{ id: "r-chunk2-sentinel", strategy_id: `q-${EXPORT_PARENT_ID_IN_CHUNK}` }];

    const tradesChunkCalls: number[] = [];
    const mock = {
      from: (table: string) => {
        return {
          select: (projection: string) => {
            const probeLimit = async () => ({ data: allParents, error: null });
            const emptyLimit = async () => ({ data: [], error: null });
            const limit =
              projection === "id" && table === "strategies"
                ? probeLimit
                : emptyLimit;
            return {
              eq: () => ({ order: () => ({ limit }), limit }),
              in: (_col: string, _ids: unknown[]) => {
                if (table !== "trades") {
                  return { order: () => ({ limit: emptyLimit }), limit: emptyLimit };
                }
                const callIdx = tradesChunkCalls.length;
                tradesChunkCalls.push(callIdx);
                const rows = callIdx === 0 ? chunk1Children : chunk2Children;
                return {
                  order: () => ({ limit: async () => ({ data: rows, error: null }) }),
                  limit: async () => ({ data: rows, error: null }),
                };
              },
            };
          },
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "18181818-1818-1818-1818-181818181818");

    // Only chunk 1 should have been fetched; chunk 2 is skipped by early-exit.
    expect(tradesChunkCalls.length).toBe(1);

    const tradesEntry = bundle.tables.find((t) => t.table === "trades");
    expect(tradesEntry).toBeDefined();
    // Row count is capped at EXPORT_PER_TABLE_ROW_CAP.
    expect(tradesEntry!.row_count).toBe(cap);
    expect(tradesEntry!.truncated_at_cap).toBe(true);
    // The chunk-2 sentinel must NOT appear (chunk 2 was not fetched).
    const ids = (tradesEntry!.rows as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain("r-chunk2-sentinel");
  });
});

/**
 * Audit 2026-05-07 red-team #7 (MED conf-9): rowsForTable wired
 * into production path. The helper's null-on-missing contract is
 * load-bearing — schema drift surfaces at the call site.
 */
describe("rowsForTable + projectedRowsForTable — wired into production (red-team #7)", () => {
  it("rowsForTable returns null (not []) when the table is missing from the bundle", () => {
    const bundle: ExportBundle = {
      schema_version: 1,
      user_id: "u",
      generated_at: "2026-04-16T00:00:00.000Z",
      total_row_count: 0,
      tables: [],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    };
    // user_notes is in the manifest but not in this synthetic bundle:
    // helper returns null to surface the schema drift.
    expect(rowsForTable(bundle, "user_notes")).toBeNull();
    expect(rowsForTable(bundle, "profiles")).toBeNull();
  });

  it("rowsForTable returns the typed array when the table is present", async () => {
    const mock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({ data: [{ id: "u" }], error: null }),
            }),
            limit: async () => ({ data: [{ id: "u" }], error: null }),
          }),
          in: () => ({
            order: () => ({
              limit: async () => ({ data: [], error: null }),
            }),
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "16161616-1616-1616-1616-161616161616");
    const profiles = rowsForTable(bundle, "profiles");
    expect(profiles).not.toBeNull();
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles!.length).toBe(1);
  });

  it("projectedRowsForTable returns null for a missing projected entry (schema drift)", () => {
    const bundle: ExportBundle = {
      schema_version: 1,
      user_id: "u",
      generated_at: "2026-04-16T00:00:00.000Z",
      total_row_count: 0,
      tables: [],
      truncated_at_size_cap: false,
      parent_id_truncated_tables: [],
      parent_id_null_dropped_tables: [],
      partial: false,
      failed_tables: [],
    };
    expect(projectedRowsForTable(bundle, "api_keys")).toBeNull();
    expect(projectedRowsForTable(bundle, "audit_log_for_user")).toBeNull();
  });
});

/**
 * Audit 2026-05-07 red-team #13 (MED conf-8): the module-level
 * ROW_JSON_CACHE WeakMap is keyed by ExportTablePayload object
 * identity. Two concurrent calls to collectUserExportBundle produce
 * two separate object identities, so cross-call aliasing is
 * impossible by construction. Pin this invariant.
 */
describe("collectUserExportBundle — concurrent same-user exports observe independent cached rows (red-team #13)", () => {
  it("two concurrent calls produce bundles whose ExportTablePayload identities are disjoint", async () => {
    const rowsA = [{ id: "row-A", tag: "alpha" }];
    const rowsB = [{ id: "row-B", tag: "beta" }];
    let callIdx = 0;
    const mock = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => {
                callIdx += 1;
                // Alternate rows between calls to mimic two concurrent
                // exports each returning their own row set.
                return {
                  data: callIdx % 2 === 1 ? rowsA : rowsB,
                  error: null,
                };
              },
            }),
            limit: async () => ({
              data: callIdx % 2 === 1 ? rowsA : rowsB,
              error: null,
            }),
          }),
          in: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    };

    const [bundleA, bundleB] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectUserExportBundle(mock as any, "17171717-1717-1717-1717-171717171717"),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      collectUserExportBundle(mock as any, "18181818-1818-1818-1818-181818181818"),
    ]);

    // The two bundles produce distinct ExportTablePayload object
    // identities. Because the WeakMap is keyed by object identity,
    // each bundle's cache entries are independent.
    const profilesA = bundleA.tables.find((t) => t.table === "profiles");
    const profilesB = bundleB.tables.find((t) => t.table === "profiles");
    expect(profilesA).toBeDefined();
    expect(profilesB).toBeDefined();
    expect(profilesA).not.toBe(profilesB);

    // Encoding each bundle through encodeExportBundle MUST produce
    // bytes derived from its own cached row content — no cross-bundle
    // aliasing. Decode each, parse, and confirm the per-bundle row
    // content rides into the correct encoding.
    const textA = new TextDecoder().decode(encodeExportBundle(bundleA));
    const textB = new TextDecoder().decode(encodeExportBundle(bundleB));
    expect(textA).not.toBe(textB);
    expect(JSON.parse(textA)).toEqual(JSON.parse(JSON.stringify(bundleA)));
    expect(JSON.parse(textB)).toEqual(JSON.parse(JSON.stringify(bundleB)));
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

        // H-0016: the pre-this seed only covered api_keys + portfolios +
        // auto-created profiles (3 of 15+ manifest tables). A migration
        // that DROPS or RENAMES one of the other ~12 manifest entries'
        // backing table (or its user_column / via_column / parent_user_column)
        // would not be caught at the live layer — only at the unit mock
        // layer, which fabricates the data shape and so cannot detect
        // real-schema drift. Seed more manifest tables against the REAL
        // schema so a column/table rename surfaces as an insert error here
        // AND a missing-rows assertion below. We deliberately cover BOTH
        // manifest kinds:
        //   - `direct`   — strategies, user_notes, user_favorites
        //                  (filtered by their own `user_id` column).
        //   - `indirect` — trades (the two-hop path: probe
        //                  strategies.user_id for parent ids, then fetch
        //                  children via `trades.strategy_id` IN (...)).
        // The indirect seed is the load-bearing addition: pre-this, ZERO
        // genuinely-indirect manifest tables were exercised against the
        // real schema, so a rename of `trades.strategy_id` (the
        // `via_column`) or `strategies.user_id` (the `parent_user_column`)
        // — the exact two-hop join the unit mock fabricates — would have
        // slipped past every test. Seeding trades and asserting its
        // row_count below closes that hole. All chosen tables ON DELETE
        // CASCADE from auth.users / profiles / strategies, so the existing
        // userIds + strategyIds cleanup tears them down with no extra
        // cleanup wiring (trades cascade-delete with their strategy).
        const { data: strategyRow, error: sErr } = await admin
          .from("strategies")
          .insert({ user_id: userId, name: "Export test strategy" })
          .select("id")
          .single();
        if (sErr || !strategyRow) {
          throw new Error(`strategies seed: ${sErr?.message}`);
        }
        cleanup.strategyIds.push(strategyRow.id);

        const { error: noteErr } = await admin
          .from("user_notes")
          .insert({ user_id: userId, content: "export-test note" });
        if (noteErr) throw new Error(`user_notes seed: ${noteErr.message}`);

        const { error: favErr } = await admin
          .from("user_favorites")
          .insert({ user_id: userId, strategy_id: strategyRow.id });
        if (favErr) throw new Error(`user_favorites seed: ${favErr.message}`);

        // H-0016 indirect-path seed: trades is `kind: "indirect"` —
        // collectUserExportBundle reaches it by first probing
        // strategies.user_id for the subject's parent ids, then fetching
        // `trades` WHERE strategy_id IN (those ids). The columns set here
        // are the trades NOT-NULL set (migration 20260405061911 +
        // 20260510181440 side CHECK); `is_fill` defaults to false.
        const { error: tradeErr } = await admin.from("trades").insert({
          strategy_id: strategyRow.id,
          exchange: "binance",
          symbol: "BTC/USDT",
          side: "buy",
          price: 42000,
          quantity: 0.1,
          fee: 0,
          fee_currency: "USDT",
          timestamp: "2026-01-01T00:00:00Z",
          order_type: "market",
        } as never);
        if (tradeErr) throw new Error(`trades seed: ${tradeErr.message}`);

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

        // H-0016: the newly-seeded manifest tables must round-trip
        // through the real schema. A row_count of 0 (or a missing entry)
        // means the manifest's table/user_column no longer matches the
        // live schema — exactly the drift the unit-mock layer cannot see.
        const strategiesTableRow = bundle.tables.find(
          (t) => t.table === "strategies",
        );
        expect(strategiesTableRow).toBeDefined();
        expect(strategiesTableRow?.row_count).toBe(1);

        const userNotesTableRow = bundle.tables.find(
          (t) => t.table === "user_notes",
        );
        expect(userNotesTableRow).toBeDefined();
        expect(userNotesTableRow?.row_count).toBe(1);

        const userFavoritesTableRow = bundle.tables.find(
          (t) => t.table === "user_favorites",
        );
        expect(userFavoritesTableRow).toBeDefined();
        expect(userFavoritesTableRow?.row_count).toBe(1);

        // H-0016 indirect-path assertion: the seeded trade must round-trip
        // through the REAL two-hop indirect query. A row_count of 0 (or a
        // missing entry, or a non-null fetch_error) means the
        // strategies->trades join broke against the live schema — i.e. the
        // manifest's `via_column` (trades.strategy_id) or
        // `parent_user_column` (strategies.user_id) no longer matches the
        // database. This is the precise drift the unit-mock layer cannot
        // detect (it fabricates the parent-probe + child `.in()` shapes).
        const tradesTableRow = bundle.tables.find((t) => t.table === "trades");
        expect(tradesTableRow).toBeDefined();
        expect(tradesTableRow?.fetch_error).toBeNull();
        expect(tradesTableRow?.row_count).toBe(1);

        // Truncation flag should be FALSE for a minimal seed
        expect(bundle.truncated_at_size_cap).toBe(false);
        // A complete seed must not flag the bundle partial — proves none
        // of the seeded manifest tables faulted against the real schema.
        expect(bundle.partial).toBe(false);
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

/**
 * H-0016 — manifest ↔ real-schema drift guard (CI-EXECUTING).
 *
 * Why this block exists (second-pass fix)
 * ---------------------------------------
 * The original H-0016 fix hardened the live-DB integration test above
 * (it.skipIf(!HAS_LIVE_DB)) to seed direct + indirect tables against the
 * real schema. That test is correct but DORMANT: the only full-suite
 * vitest run in CI (ci.yml `frontend-test`) has NO Supabase env, so
 * HAS_LIVE_DB is false and the seeded assertions SKIP — they provide
 * zero automated protection (codebase invariant "Live-DB vitest tests
 * skip in CI"). A migration that drops a manifest table or renames a
 * manifest FILTER/JOIN column (`user_column`, `via_column`,
 * `parent_user_column`, `parent_id_column`) would ship green, then 500
 * the Art. 15/20 export in production (`fetch_error` -> `partial:true`).
 *
 * This block closes the gap STRUCTURALLY and runs in EVERY CI pass with
 * NO live DB. It parses `src/lib/database.types.ts` — the generated,
 * checked-in mirror of the live schema (regenerated whenever a migration
 * changes the schema; the same single source of truth the existing
 * `gdpr-export-schema.test.ts` uses for the ORDER-column drift guard) —
 * and asserts that, for EVERY manifest spec, the columns the SELECT
 * actually FILTERS / JOINS on exist on the tables they reference.
 *
 * The existing `gdpr-export-schema.test.ts` only validates the ORDER
 * column. It does NOT cover the load-bearing filter/join columns that
 * H-0016 is about — a rename of `trades.strategy_id` (via_column) or
 * `strategies.user_id` (parent_user_column) is invisible to an
 * order-column check. This block covers exactly those columns:
 *   - direct    -> spec.table exists; spec.user_column on spec.table
 *   - projected -> spec.source_table exists; spec.user_column on it
 *   - indirect  -> spec.table exists; spec.via_column on spec.table;
 *                  spec.parent_table exists; spec.parent_user_column on
 *                  parent; (spec.parent_id_column ?? "id") on parent
 *
 * Non-tautological: if a future regeneration drops/renames any of these
 * columns while the manifest still references the old name, the matching
 * assertion fails here BEFORE the export 500s prod. The anchor-guard test
 * proves the parser is actually finding columns (so the assertions can't
 * vacuously pass on a format change).
 */
const TYPES_FILE_H0016 = join(
  process.cwd(),
  "src",
  "lib",
  "database.types.ts",
);

/**
 * Parse `database.types.ts` into table -> set-of-Row-column-names.
 * Mirrors the proven parser in `gdpr-export-schema.test.ts`: the
 * generated file emits `      <table>: {` then `        Row: {` then
 * each column as `          <col>: <type>`.
 */
function parseRowColumnsH0016(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const tableRe =
    /^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  const colRe = /^ {10}([a-z0-9_]+):/gm;
  for (const tableMatch of src.matchAll(tableRe)) {
    const table = tableMatch[1];
    const body = tableMatch[2];
    const cols = new Set<string>();
    for (const colMatch of body.matchAll(colRe)) {
      cols.add(colMatch[1]);
    }
    out.set(table, cols);
  }
  return out;
}

describe("H-0016 — manifest filter/join columns exist on the real schema (no skip)", () => {
  const src = readFileSync(TYPES_FILE_H0016, "utf8");
  const rowColumns = parseRowColumnsH0016(src);

  it("parser found anchor tables + columns (guards against a vacuous pass)", () => {
    // If the generated-file format ever changes and the parser silently
    // returns empty sets, EVERY assertion below would pass vacuously.
    // Pin a known direct owner column, a known indirect via/parent
    // column, and a projected source owner column so a parser break is
    // loud, not silent.
    expect(rowColumns.size).toBeGreaterThan(20);
    expect(rowColumns.get("strategies")?.has("user_id")).toBe(true); // parent_user_column
    expect(rowColumns.get("trades")?.has("strategy_id")).toBe(true); // indirect via_column
    expect(rowColumns.get("audit_log")?.has("user_id")).toBe(true); // projected user_column
    expect(rowColumns.get("profiles")?.has("id")).toBe(true); // direct user_column = "id"
  });

  it("every DIRECT spec's table + user_column exist on the real schema", () => {
    for (const spec of USER_EXPORT_TABLES) {
      if (spec.kind !== "direct") continue;
      const cols = rowColumns.get(spec.table);
      expect(
        cols,
        `manifest DIRECT table "${spec.table}" not found in database.types.ts — a migration dropped/renamed it but the manifest still SELECTs it (.from("${spec.table}") -> 42P01, export 500s)`,
      ).toBeDefined();
      expect(
        cols!.has(spec.user_column),
        `DIRECT spec for "${spec.table}" filters by .eq("${spec.user_column}", userId) but that column does not exist on ${spec.table} — a rename raises Postgres 42703 -> fetch_error -> partial:true -> the Art. 15 export 500s for every user (H-0016)`,
      ).toBe(true);
    }
  });

  it("every PROJECTED spec's source_table + user_column exist on the real schema", () => {
    for (const spec of USER_EXPORT_TABLES) {
      if (spec.kind !== "projected") continue;
      const cols = rowColumns.get(spec.source_table);
      expect(
        cols,
        `manifest PROJECTED source_table "${spec.source_table}" (bundle "${spec.table}") not found in database.types.ts — the SELECT .from("${spec.source_table}") would 42P01 and 500 the export`,
      ).toBeDefined();
      expect(
        cols!.has(spec.user_column),
        `PROJECTED spec for source "${spec.source_table}" declares user_column "${spec.user_column}" but that column does not exist on ${spec.source_table} — the .eq()/or_filter owner predicate would 42703 (or silently return zero rows), dropping the subject's data from the bundle (H-0016)`,
      ).toBe(true);
    }
  });

  it("every INDIRECT spec's via/parent/parent_id columns exist on the real schema (two-hop join)", () => {
    for (const spec of USER_EXPORT_TABLES) {
      if (spec.kind !== "indirect") continue;

      // Child table + via_column (the `.in(via_column, parentIds)` leg).
      const childCols = rowColumns.get(spec.table);
      expect(
        childCols,
        `manifest INDIRECT child table "${spec.table}" not found in database.types.ts — .from("${spec.table}") would 42P01 and 500 the export`,
      ).toBeDefined();
      expect(
        childCols!.has(spec.via_column),
        `INDIRECT spec for "${spec.table}" joins on .in("${spec.via_column}", parentIds) but ${spec.via_column} does not exist on ${spec.table} — a via_column rename raises 42703 -> fetch_error -> partial:true -> export 500 (this is the exact two-hop column the unit mock fabricates; only this real-schema check catches the drift) (H-0016)`,
      ).toBe(true);

      // Parent table + parent_user_column (the `.eq(parent_user_column, userId)` probe).
      const parentCols = rowColumns.get(spec.parent_table);
      expect(
        parentCols,
        `manifest INDIRECT parent_table "${spec.parent_table}" (via "${spec.table}") not found in database.types.ts — the parent-id probe would 42P01 and 500 the export`,
      ).toBeDefined();
      expect(
        parentCols!.has(spec.parent_user_column),
        `INDIRECT spec for "${spec.table}" probes parent ${spec.parent_table} by .eq("${spec.parent_user_column}", userId) but that column does not exist on ${spec.parent_table} — a parent_user_column rename raises 42703 on the parent probe -> fetch_error -> partial:true -> export 500 (H-0016)`,
      ).toBe(true);

      // parent_id_column (defaults to "id" at the call site in fetchRowsForSpec).
      const parentIdColumn = spec.parent_id_column ?? "id";
      expect(
        parentCols!.has(parentIdColumn),
        `INDIRECT spec for "${spec.table}" reads parent ids from ${spec.parent_table}.${parentIdColumn} (parent_id_column ${spec.parent_id_column ? `="${spec.parent_id_column}"` : 'defaulted to "id"'}) but that column does not exist on ${spec.parent_table} — .select("${parentIdColumn}")/.order("${parentIdColumn}") raises 42703 -> the indirect child returns zero rows / 500s (H-0016)`,
      ).toBe(true);
    }
  });
});
