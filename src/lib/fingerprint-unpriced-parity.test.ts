/**
 * Phase 170.4 plan 09, Task 3 (review WR-02, TODOS 170.4-FINGERPRINT-UNPRICED-TWIN):
 * the TypeScript fingerprint and the SQL recompute count the same keys when a
 * native-unpriced marker removes one.
 *
 * `commit_scenario_batch` recomputes the holdings fingerprint server-side from
 * the same rule `fetchLatestHoldingsPerKey` applies in the browser path. If the
 * two diverge, a book-mode commit is refused as `portfolio_fingerprint_stale` and
 * no refresh can clear it. The SQL side is gated by
 * supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql, which
 * passes a hand-typed fingerprint literal to the RPC and marks it
 * `-- PARITY-FINGERPRINT(<case>): <literal>`. This test reads those literals OUT
 * OF THE GATE FILE and requires the TypeScript path to produce exactly them from
 * the same rows, so the two runtimes are bound to the same bytes. A literal the
 * gate passes to the RPC but the browser would never send, or the reverse, fails
 * here.
 *
 * The fixture is hand-typed (never derived from the gate), allocator A:
 *   key-u  (mt5, its own account)   spot ACCOUNT-U on 2026-10-09, marker dated M
 *   key-s  (mt5, `duplicate` of key-u) spot ACCOUNT-S on 2026-10-09
 *   key-b  (binance, its own account) spot BTC on 2026-10-10
 *   M = 2026-10-10 (unpriced-dropped) or 2026-10-08 (older-marker-ignored)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// queries.ts imports the server-only Supabase clients; the derive under test is
// pure, so both are stubbed to nothing (same scaffolding as
// queries.holdings-per-key.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { computeHoldingsFingerprint } from "@/app/(dashboard)/allocations/lib/scenario-state";
import { derivePhase07Fields } from "./queries";
import {
  fetchLatestHoldingsPerKey,
  NATIVE_UNPRICED_KIND_PREFIX,
} from "./latest-holdings-per-key";

const GATE = join(
  process.cwd(),
  "supabase",
  "tests",
  "test_commit_scenario_batch_fingerprint_unpriced.sql",
);

/**
 * The literal a `-- PARITY-FINGERPRINT(<name>): <literal>` marker names, and the
 * literal of the constant declaration on the line that follows it. The gate is
 * only a binding if the comment and the value the RPC actually receives agree.
 */
function gateLiteral(name: string): string {
  const lines = readFileSync(GATE, "utf8").split("\n");
  const marker = `-- PARITY-FINGERPRINT(${name}): `;
  const at = lines.findIndex((l) => l.trim().startsWith(marker));
  if (at < 0) throw new Error(`PARITY-FINGERPRINT(${name}) not found in ${GATE}`);
  const literal = lines[at].trim().slice(marker.length);
  const declared = /:=\s*'([^']*)'\s*;/.exec(lines[at + 1] ?? "");
  if (declared === null) {
    throw new Error(`PARITY-FINGERPRINT(${name}) is not followed by a constant declaration`);
  }
  expect(declared[1], `the gate's constant for ${name} must equal its marker`).toBe(literal);
  return literal;
}

const ALLOCATOR = "allocator-a";
const KEY_U = "key-u";
const KEY_S = "key-s";
const KEY_B = "key-b";

type KeyDb = {
  id: string;
  user_id: string;
  exchange: string;
  venue_account_id: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
};

const KEYS: KeyDb[] = [
  { id: KEY_U, user_id: ALLOCATOR, exchange: "mt5", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
  { id: KEY_S, user_id: ALLOCATOR, exchange: "mt5", venue_account_id: null, account_share_kind: "duplicate", account_shared_with_api_key_id: KEY_U },
  { id: KEY_B, user_id: ALLOCATOR, exchange: "binance", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
];

const holding = (api_key_id: string, venue: string, symbol: string, asof: string) => ({
  allocator_id: ALLOCATOR,
  api_key_id,
  venue,
  symbol,
  asof,
  holding_type: "spot",
  side: null,
  quantity: 1,
  mark_price: 100,
  value_usd: 100,
  entry_price: null,
  unrealized_pnl_usd: null,
  quantity_unit: null,
  updated_at: "2026-10-11T04:00:00+00:00",
});

const HOLDINGS = [
  holding(KEY_U, "mt5", "ACCOUNT-U", "2026-10-09"),
  holding(KEY_S, "mt5", "ACCOUNT-S", "2026-10-09"),
  holding(KEY_B, "binance", "BTC", "2026-10-10"),
];

/**
 * A hand-rolled client that answers each read of `fetchLatestHoldingsPerKey` from
 * the fixture, honouring eq, order and limit. `audit_log` is empty (no clean poll
 * exists in this fixture); `allocator_equity_derived` carries the one marker.
 */
function fakeClient(markerAsof: string) {
  const derived = [
    {
      allocator_id: ALLOCATOR,
      kind: `${NATIVE_UNPRICED_KIND_PREFIX}${KEY_U}`,
      payload: { native_unpriced: true, asof: markerAsof },
    },
  ];
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      const chain = {
        select() {
          return chain;
        },
        eq(c: string, v: unknown) {
          eqs.push([c, v]);
          return chain;
        },
        order(c: string, o: { ascending: boolean }) {
          order = { column: c, ascending: o.ascending };
          return chain;
        },
        limit(n: number) {
          limit = n;
          return chain;
        },
        then(resolve: (v: unknown) => void) {
          const source = (
            table === "api_keys"
              ? KEYS
              : table === "audit_log"
                ? []
                : table === "allocator_equity_derived"
                  ? derived
                  : HOLDINGS
          ) as Array<Record<string, unknown>>;
          // `user_id` on api_keys, `allocator_id` elsewhere: the fake keys on the column.
          let rows = source.filter((r) =>
            eqs.every(([c, v]) => (c === "user_id" && table === "api_keys" ? r.user_id === v : r[c] === v)),
          );
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

/** The browser's fingerprint for the fixture: reader, then the payload derive, then the token set. */
async function clientFingerprint(markerAsof: string): Promise<string> {
  const read = await fetchLatestHoldingsPerKey(fakeClient(markerAsof), ALLOCATOR, "*");
  expect(read.error).toBeNull();
  const apiKeys = KEYS.map((k) => ({
    id: k.id,
    is_active: true,
    exchange: k.exchange,
    sync_status: "complete",
    last_sync_at: "2026-10-11T04:00:00+00:00",
    disconnected_at: null,
    venue_account_id: k.venue_account_id,
    account_share_kind: k.account_share_kind,
    account_shared_with_api_key_id: k.account_shared_with_api_key_id,
  }));
  const payload = derivePhase07Fields(
    apiKeys,
    (read.data ?? []) as Parameters<typeof derivePhase07Fields>[1],
    null,
    read.partialReads,
    read.accountByKey,
  );
  return computeHoldingsFingerprint(payload.holdingsFingerprintRows ?? []);
}

describe("PARITY-FINGERPRINT: the TypeScript fingerprint is the literal the SQL gate passes to the RPC (WR-02)", () => {
  it("unpriced-dropped: a marker dated after the rows drops key-u and its sibling key-s, leaving BTC:binance:spot", async () => {
    expect(await clientFingerprint("2026-10-10")).toBe(gateLiteral("unpriced-dropped"));
  });

  it("older-marker-ignored: a marker dated before the rows drops nothing, leaving all three tokens", async () => {
    expect(await clientFingerprint("2026-10-08")).toBe(gateLiteral("older-marker-ignored"));
  });

  it("the two cases differ, so a reader that ignored the marker could not satisfy both", async () => {
    expect(gateLiteral("unpriced-dropped")).not.toBe(gateLiteral("older-marker-ignored"));
  });
});
