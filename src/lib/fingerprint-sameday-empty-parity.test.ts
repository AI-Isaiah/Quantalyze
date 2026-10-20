/**
 * Phase 167.1.2.1.2 plan 05 (D-02, orchestrator decisions O-1 and O-3): the
 * TypeScript fingerprint and the SQL recompute count the same keys when a key's
 * newest poll read nothing on the rows' own day.
 *
 * `commit_scenario_batch` recomputes the holdings fingerprint server-side from the
 * same rule `fetchLatestHoldingsPerKey` applies in the browser path. D-02 hides a
 * key from the dashboard when its newest poll event of any outcome is a clean poll
 * that read zero rows, dated the key's own latest rows' day. The browser
 * fingerprints what the dashboard shows, so if the RPC kept counting such a key the
 * two sets would differ and every book-mode commit of that book would be refused
 * `portfolio_fingerprint_stale` (HTTP 409), with nothing a refresh could do. The
 * SQL side is gated by
 * supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql, which
 * passes a hand-typed fingerprint literal to the RPC and marks it
 * `-- PARITY-FINGERPRINT(<case>): <literal>`. This test reads that literal OUT OF
 * THE GATE FILE and requires the TypeScript path to produce exactly it from the
 * same rows and events, so the two runtimes are bound to the same bytes.
 *
 * The fixture is hand-typed (never derived from the gate), allocator A:
 *   key-k (binance, its own account) spot BTC on 2026-10-10; poll events, oldest
 *         first: clean row_count 1 asof 2026-10-10, clean row_count 0 asof 2026-10-10
 *   key-l (bybit, its own account)   spot ETH on 2026-10-10; no event
 *
 * Plan 06 adds the four keep arms (KEEP_ARMS): each leaves key-k in the fingerprint
 * (BTC:binance:spot|ETH:bybit:spot), and each name binds to its own marker in the gate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// queries.ts imports the server-only Supabase clients; the derive under test is
// pure, so both are stubbed to nothing (same scaffolding as
// fingerprint-unpriced-parity.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { computeHoldingsFingerprint } from "@/app/(dashboard)/allocations/lib/scenario-state";
import { derivePhase07Fields } from "./queries";
import { fetchLatestHoldingsPerKey, POLL_COMPLETED_ACTION } from "./latest-holdings-per-key";

const GATE = join(
  process.cwd(),
  "supabase",
  "tests",
  "test_commit_scenario_batch_fingerprint_sameday_empty.sql",
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
const KEY_K = "key-k";
const KEY_L = "key-l";

type KeyDb = {
  id: string;
  user_id: string;
  exchange: string;
  venue_account_id: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
};

const KEYS: KeyDb[] = [
  { id: KEY_K, user_id: ALLOCATOR, exchange: "binance", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
  { id: KEY_L, user_id: ALLOCATOR, exchange: "bybit", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
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
  updated_at: "2026-10-10T04:00:00+00:00",
});

const HOLDINGS = [
  holding(KEY_K, "binance", "BTC", "2026-10-10"),
  holding(KEY_L, "bybit", "ETH", "2026-10-10"),
];

const pollEvent = (
  entity_id: string,
  created_at: string,
  row_count: number,
  asof: string,
  final_status = "complete",
) => ({
  user_id: ALLOCATOR,
  action: POLL_COMPLETED_ACTION,
  entity_type: "api_key",
  entity_id,
  metadata: { final_status, row_count, asof },
  created_at,
});

/** The gate's two events for key-k, oldest first. */
const EVENTS = [
  pollEvent(KEY_K, "2026-10-10T01:00:00+00:00", 1, "2026-10-10"),
  pollEvent(KEY_K, "2026-10-10T02:00:00+00:00", 0, "2026-10-10"),
];

/**
 * A hand-rolled client that answers each read of `fetchLatestHoldingsPerKey` from
 * the fixture, honouring eq, order and limit. `audit_log` serves EVENTS, and the
 * production `pollRes` filter on the flattened `metadata->>final_status` column is
 * honoured by reading it out of the metadata. `allocator_equity_derived` is empty
 * (no native-unpriced marker exists in this fixture).
 */
function fakeClient(
  events: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<KeyDb> = KEYS,
  holdings: ReadonlyArray<Record<string, unknown>> = HOLDINGS,
) {
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
              ? keys
              : table === "audit_log"
                ? events
                : table === "allocator_equity_derived"
                  ? []
                  : holdings
          ) as Array<Record<string, unknown>>;
          const column = (r: Record<string, unknown>, c: string): unknown => {
            if (c === "metadata->>final_status") {
              return (r.metadata as Record<string, unknown> | undefined)?.final_status;
            }
            return r[c];
          };
          let rows = source.filter((r) => eqs.every(([c, v]) => column(r, c) === v));
          if (order) {
            const { column: by, ascending } = order;
            rows = [...rows].sort(
              (a, b) => (String(a[by]) < String(b[by]) ? -1 : 1) * (ascending ? 1 : -1),
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
async function clientFingerprint(
  events: ReadonlyArray<Record<string, unknown>>,
  keys: ReadonlyArray<KeyDb> = KEYS,
  holdings: ReadonlyArray<Record<string, unknown>> = HOLDINGS,
): Promise<string> {
  const read = await fetchLatestHoldingsPerKey(fakeClient(events, keys, holdings), ALLOCATOR, "*");
  expect(read.error).toBeNull();
  const apiKeys = keys.map((k) => ({
    id: k.id,
    is_active: true,
    exchange: k.exchange,
    sync_status: "complete",
    last_sync_at: "2026-10-10T04:00:00+00:00",
    disconnected_at: null,
    venue_account_id: k.venue_account_id,
    account_share_kind: k.account_share_kind,
    account_shared_with_api_key_id: k.account_shared_with_api_key_id,
  }));
  const payload = derivePhase07Fields(
    apiKeys,
    [],
    0,
    (read.data ?? []) as Parameters<typeof derivePhase07Fields>[3],
    false,
    null,
    read.partialReads,
    read.accountByKey,
  );
  return computeHoldingsFingerprint(payload.holdingsFingerprintRows ?? []);
}

/** The four keep arms of the gate: each fixture is the gate's, typed by hand, oldest event first. */
const KEEP_ARMS: ReadonlyArray<{ name: string; why: string; events: ReadonlyArray<Record<string, unknown>> }> = [
  {
    name: "sameday-nonempty-kept",
    why: "the newest poll is clean but read one row on the rows' own day",
    events: [pollEvent(KEY_K, "2026-10-10T02:00:00+00:00", 1, "2026-10-10")],
  },
  {
    name: "later-warnings-poll-kept",
    why: "a later poll that finished with warnings and read one row follows the clean empty poll",
    events: [
      pollEvent(KEY_K, "2026-10-10T01:00:00+00:00", 0, "2026-10-10"),
      pollEvent(KEY_K, "2026-10-10T02:00:00+00:00", 1, "2026-10-10", "complete_with_warnings"),
    ],
  },
  {
    name: "warnings-empty-kept",
    why: "the only poll finished with warnings, so it is not a clean empty poll",
    events: [pollEvent(KEY_K, "2026-10-10T02:00:00+00:00", 0, "2026-10-10", "complete_with_warnings")],
  },
  {
    name: "older-empty-day-kept",
    why: "the clean empty poll is dated the day before the rows",
    events: [pollEvent(KEY_K, "2026-10-10T02:00:00+00:00", 0, "2026-10-09")],
  },
];

describe("PARITY-FINGERPRINT: the TypeScript fingerprint is the literal the SQL gate passes to the RPC (D-02)", () => {
  it("sameday-empty-dropped: a newest poll that read nothing on the rows' own day drops key-k, leaving ETH:bybit:spot", async () => {
    expect(await clientFingerprint(EVENTS)).toBe(gateLiteral("sameday-empty-dropped"));
  });

  it("without the empty poll the reader keeps key-k, so the fixture cannot satisfy the literal vacuously", async () => {
    // Only the first event (row_count 1): nothing hides key-k, both tokens count.
    expect(await clientFingerprint(EVENTS.slice(0, 1))).toBe("BTC:binance:spot|ETH:bybit:spot");
  });

  for (const arm of KEEP_ARMS) {
    it(`${arm.name}: ${arm.why}, so key-k stays and the fingerprint is the gate's literal`, async () => {
      expect(await clientFingerprint(arm.events)).toBe(gateLiteral(arm.name));
    });
  }

  it("sameday-empty-sibling-older: the emptied key keeps its day, so a same-account sibling's older rows drop out, leaving SOL:bybit:spot", async () => {
    // The gate's fixture, typed by hand: key-a (binance) rows 2026-10-10 and a clean empty
    // poll the same day; key-b (binance, the 'duplicate' marker naming key-a, so one
    // account) rows 2026-10-09; key-c (bybit, its own account) rows 2026-10-10.
    const keys: KeyDb[] = [
      { id: "key-a", user_id: ALLOCATOR, exchange: "binance", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
      { id: "key-b", user_id: ALLOCATOR, exchange: "binance", venue_account_id: null, account_share_kind: "duplicate", account_shared_with_api_key_id: "key-a" },
      { id: "key-c", user_id: ALLOCATOR, exchange: "bybit", venue_account_id: null, account_share_kind: null, account_shared_with_api_key_id: null },
    ];
    const holdings = [
      holding("key-a", "binance", "BTC", "2026-10-10"),
      holding("key-b", "binance", "ETH", "2026-10-09"),
      holding("key-c", "bybit", "SOL", "2026-10-10"),
    ];
    const events = [pollEvent("key-a", "2026-10-10T02:00:00+00:00", 0, "2026-10-10")];
    expect(await clientFingerprint(events, keys, holdings)).toBe(gateLiteral("sameday-empty-sibling-older"));
    // Without the emptying poll key-a keeps its rows and key-b's older rows still drop out,
    // so the literal above is not satisfied by key-b being ignored for some other reason.
    expect(await clientFingerprint([], keys, holdings)).toBe("BTC:binance:spot|SOL:bybit:spot");
  });

  it("the dropped literal differs from every kept literal, so the gate's two sides cannot be the same bytes", () => {
    const dropped = gateLiteral("sameday-empty-dropped");
    for (const arm of KEEP_ARMS) {
      expect(gateLiteral(arm.name), `${arm.name} must keep a token the dropped fingerprint lacks`).not.toBe(dropped);
    }
    // Specifically: the kept literal carries key-k's token and the dropped one does not.
    expect(dropped).not.toContain("BTC:binance:spot");
    for (const arm of KEEP_ARMS) expect(gateLiteral(arm.name)).toContain("BTC:binance:spot");
  });
});
