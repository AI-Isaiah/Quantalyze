/**
 * Phase 235 HOLD-02: the TypeScript half of the native-unpriced reading-day rule,
 * replayed against the case table the matcher's pytest reads too
 * (`analytics-service/tests/fixtures/native_unpriced_account_day_cases.json`,
 * `analytics-service/tests/test_match_native_unpriced_account_day.py`).
 *
 * WHY. The match AUM must equal what Holdings counts for a multi-key account. The TS
 * reader (`fetchLatestHoldingsPerKey` then `oneKeyPerAccountDay`) is the REFERENCE: a
 * key's marker day is its reading day, with no rows, when it is strictly after the
 * key's newest asof. The matcher reads no audit log, so parity is rows plus markers
 * only: the audit log is served empty in the dashboard's default mode, and the replay
 * also runs `{ auditEvidence: false }`, the scenario commit's mode. Every figure in the
 * file is hand-typed; nothing here derives an expectation from the code under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { oneKeyPerAccountDay } from "./holdings-account-day";
import {
  fetchLatestHoldingsPerKey,
  NATIVE_UNPRICED_KIND_PREFIX,
} from "./latest-holdings-per-key";

type CaseKey = {
  id: string;
  exchange: string;
  venue_account_id: string | null;
  venue_server: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
};

type CaseRow = {
  key: string;
  venue: string;
  symbol: string;
  holding_type: string;
  value_usd: number;
  asof: string;
  updated_at: string;
};

type Case = {
  name: string;
  keys: CaseKey[];
  rows: CaseRow[];
  markers: Record<string, string>;
  marker_read_fails: boolean;
  expected_counted_keys: string[];
  expected_total_usd: number;
};

const spec = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "analytics-service/tests/fixtures/native_unpriced_account_day_cases.json",
    ),
    "utf8",
  ),
) as { allocator_id: string; cases: Case[] };

type ReadRow = {
  api_key_id: string;
  value_usd: number;
  asof: string;
  updated_at: string;
  holding_type: string;
};

const COLUMNS =
  "api_key_id, venue, symbol, holding_type, value_usd, unrealized_pnl_usd, asof, updated_at";

/**
 * A hand-rolled client that answers each read of `fetchLatestHoldingsPerKey` from the
 * case, honouring eq, order and limit. `audit_log` is empty; every
 * `allocator_equity_derived` read fails when the case says the marker read fails.
 */
function clientFor(c: Case) {
  const allocator = spec.allocator_id;
  const keys = c.keys.map((k) => ({ ...k, user_id: allocator }));
  const holdings = c.rows.map((r) => ({
    allocator_id: allocator,
    api_key_id: r.key,
    venue: r.venue,
    symbol: r.symbol,
    holding_type: r.holding_type,
    value_usd: r.value_usd,
    unrealized_pnl_usd: null,
    asof: r.asof,
    updated_at: r.updated_at,
  }));
  const derived = Object.entries(c.markers).map(([key, day]) => ({
    allocator_id: allocator,
    kind: `${NATIVE_UNPRICED_KIND_PREFIX}${key}`,
    payload: { native_unpriced: true, asof: day },
  }));
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, v: unknown) {
          eqs.push([col, v]);
          return chain;
        },
        order(col: string, o: { ascending: boolean }) {
          order = { column: col, ascending: o.ascending };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          if (table === "allocator_equity_derived" && c.marker_read_fails) {
            resolve({ data: null, error: { message: "marker table unavailable (test)" } });
            return;
          }
          const source = (
            table === "api_keys"
              ? keys
              : table === "audit_log"
                ? []
                : table === "allocator_equity_derived"
                  ? derived
                  : holdings
          ) as Array<Record<string, unknown>>;
          let rows = source.filter((r) => eqs.every(([col, v]) => r[col] === v));
          if (order) {
            const { column, ascending } = order;
            rows = [...rows].sort(
              (a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1),
            );
          }
          if (limit !== null) rows = rows.slice(0, limit);
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchLatestHoldingsPerKey>[0];
}

describe("the TS reader counts what the shared native-unpriced case table says", () => {
  const modes: Array<[string, { auditEvidence?: boolean }]> = [
    ["dashboard mode (default)", {}],
    ["commit mode (auditEvidence: false)", { auditEvidence: false }],
  ];

  it("the shared table is not empty", () => {
    expect(spec.cases.length).toBeGreaterThan(0);
  });

  describe.each(modes)("%s", (_label, opts) => {
    it.each(spec.cases.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
      // The failed-read arm logs at ERROR by design; keep the test output clean.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const read = await fetchLatestHoldingsPerKey(clientFor(c), spec.allocator_id, COLUMNS, opts);
        expect(read.error, `${c.name}: read error`).toBeNull();
        const rows = (read.data ?? []) as ReadRow[];
        for (const r of rows) {
          expect(read.accountByKey[r.api_key_id], `${c.name}: accountByKey carries ${r.api_key_id}`).toBeDefined();
        }
        const counted = oneKeyPerAccountDay(rows, (k) => read.accountByKey[k]);
        const keysCounted = [...new Set(counted.map((r) => r.api_key_id))].sort();
        const total = counted.reduce((sum, r) => sum + r.value_usd, 0);
        expect(keysCounted, `${c.name}: counted keys`).toEqual(c.expected_counted_keys);
        expect(total, `${c.name}: total`).toBe(c.expected_total_usd);
        if (c.marker_read_fails) {
          expect(read.markerReadError, `${c.name}: markerReadError`).not.toBeNull();
        }
      } finally {
        errorSpy.mockRestore();
      }
    });
  });
});
