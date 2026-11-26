/**
 * Phase 225 ONEACCOUNTONCE plan 16 (CONN-03, CONTEXT Q6 item 1, PR-3 review CR-01): the
 * TypeScript fingerprint and the SQL recompute count the same accounts when one login
 * sits on more than one broker server.
 *
 * `commit_scenario_batch` recomputes the holdings fingerprint server-side from the same
 * account identity the browser applies (`accountIdentityTokens`, fed through
 * `fetchLatestHoldingsPerKey`'s `keyAccountOf`). Before the server joined the identity, the
 * recompute grouped an owner's keys by (exchange, login) alone, so a login on two servers
 * was ONE account there and TWO in the browser, and every book-mode commit of that owner
 * was refused `portfolio_fingerprint_stale` (HTTP 409) with nothing a refresh could do. The
 * SQL side is gated by
 * supabase/tests/test_commit_scenario_batch_venue_server_identity.sql, which passes a
 * hand-typed fingerprint literal to the RPC per arm and marks it
 * `-- PARITY-FINGERPRINT(<arm>): <literal>`. This test reads each literal OUT OF THE GATE
 * FILE and requires the TypeScript path to produce exactly it from the same rows, so the
 * two runtimes are bound to the same bytes. It also fails when a marker in the gate has no
 * case here, so a later SQL arm cannot skip the TypeScript replay.
 *
 * The fixtures are hand-typed (never derived from the gate), one allocator per arm. Every
 * key carries one spot row on 2026-11-09 (older, "O") or 2026-11-10 (newer, "N"); within
 * one account only the newest day contributes, so an arm tells "one account" from "two
 * accounts" by whether the older row is in the fingerprint. An always-kept okx key with no
 * login (SOL) keeps every fingerprint non-empty.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// queries.ts imports the server-only Supabase clients; the derive under test is pure, so
// both are stubbed to nothing (same scaffolding as fingerprint-sameday-empty-parity.test.ts).
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { computeHoldingsFingerprint } from "@/app/(dashboard)/allocations/lib/scenario-state";
import { derivePhase07Fields } from "./queries";
import { fetchLatestHoldingsPerKey } from "./latest-holdings-per-key";

const GATE = join(
  process.cwd(),
  "supabase",
  "tests",
  "test_commit_scenario_batch_venue_server_identity.sql",
);

const ALLOCATOR = "allocator-a";
const OLD = "2026-11-09";
const NEW = "2026-11-10";

/** Every `-- PARITY-FINGERPRINT(<name>): <literal>` marker in the gate, in file order. */
function gateMarkers(): string[] {
  const names: string[] = [];
  for (const line of readFileSync(GATE, "utf8").split("\n")) {
    const m = /^\s*--\s*PARITY-FINGERPRINT\(([^)]+)\):/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * The literal a `-- PARITY-FINGERPRINT(<name>): <literal>` marker names, and the literal of
 * the constant declaration on the line that follows it. The gate is only a binding if the
 * comment and the value the RPC actually receives agree.
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

type KeyDb = {
  id: string;
  user_id: string;
  exchange: string;
  venue_account_id: string | null;
  venue_server: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
  /** The gate disconnects every key but one per login; liveness is not identity. */
  live: boolean;
};

type Spec = {
  id: string;
  exchange: string;
  login: string | null;
  server: string | null;
  live: boolean;
  day: string;
  symbol: string;
  /** The holdings row's venue column (the gate writes the lower-case exchange). */
  venue: string;
  marker?: { kind: string; target: string };
};

const spec = (
  id: string,
  exchange: string,
  login: string | null,
  server: string | null,
  live: boolean,
  day: string,
  symbol: string,
  marker?: { kind: string; target: string },
  venue: string = exchange.toLowerCase(),
): Spec => ({ id, exchange, login, server, live, day, symbol, venue, marker });

/** The always-kept key: no login, so it is its own account on every arm. */
const Z = spec("k_z", "okx", null, null, true, NEW, "SOL");

/** One entry per `PARITY-FINGERPRINT(<arm>)` marker in the gate, typed by hand from its fixture. */
const CASES: ReadonlyArray<{ name: string; why: string; specs: Spec[] }> = [
  {
    name: "two-servers-two-accounts",
    why: "one login on srv-a and srv-b is two accounts, so the older srv-a row still counts",
    specs: [
      spec("k_a", "mt5", "L1001", "srv-a", true, OLD, "BTC"),
      spec("k_b", "mt5", "L1001", "srv-b", false, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "same-server-pair-one-account",
    why: "two keys on one login and the same server are one account, so the older row drops out",
    specs: [
      spec("k_a", "mt5", "L1002", "srv-a", true, OLD, "BTC"),
      spec("k_b", "mt5", "L1002", "srv-a", false, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "null-joins-single-server",
    why: "a no-server key joins its login while the login carries one server, so the older row drops out",
    specs: [
      spec("k_a", "mt5", "L1003", "srv-a", true, OLD, "BTC"),
      spec("k_n", "mt5", "L1003", null, false, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "null-ambiguous-own-account",
    why: "a no-server key on a login with two servers is its own account, so its older row counts",
    specs: [
      spec("k_a", "mt5", "L1004", "srv-a", true, NEW, "BTC"),
      spec("k_b", "mt5", "L1004", "srv-b", false, NEW, "ETH"),
      spec("k_n", "mt5", "L1004", null, false, OLD, "LTC"),
      Z,
    ],
  },
  {
    name: "all-null-one-account",
    why: "two no-server keys on one login are one account, so the older row drops out",
    specs: [
      spec("k_a", "mt5", "L1005", null, true, OLD, "BTC"),
      spec("k_b", "mt5", "L1005", null, false, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "two-nulls-ambiguous",
    why: "two unknown keys on a login with two servers never join each other, so both rows count",
    specs: [
      spec("k_a", "mt5", "L1006", "srv-a", true, NEW, "BTC"),
      spec("k_b", "mt5", "L1006", "srv-b", false, NEW, "ETH"),
      spec("k_n1", "mt5", "L1006", null, false, OLD, "LTC"),
      spec("k_n2", "mt5", "L1006", null, false, NEW, "XRP"),
      Z,
    ],
  },
  {
    name: "three-servers-plus-null",
    why: "with three servers a no-server key is still ambiguous, so its older row counts",
    specs: [
      spec("k_a", "mt5", "L1007", "srv-a", true, NEW, "BTC"),
      spec("k_b", "mt5", "L1007", "srv-b", false, NEW, "ETH"),
      spec("k_c", "mt5", "L1007", "srv-c", false, NEW, "DOT"),
      spec("k_n", "mt5", "L1007", null, false, OLD, "LTC"),
      Z,
    ],
  },
  {
    name: "other-exchange-same-login",
    why: "an mt5 key and an okx key with one login and one server are two accounts",
    specs: [
      spec("k_a", "mt5", "L1008", "srv-a", true, OLD, "BTC"),
      spec("k_b", "okx", "L1008", "srv-a", true, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "exchange-partitions-server-count",
    why: "the server count is per exchange, so the mt5 no-server key joins srv-a despite an okx key on another server",
    specs: [
      spec("k_a", "mt5", "L1009", "srv-a", true, OLD, "BTC"),
      spec("k_n", "mt5", "L1009", null, false, NEW, "ETH"),
      spec("k_o", "okx", "L1009", "srv-b", true, NEW, "LTC"),
      Z,
    ],
  },
  {
    name: "exchange-case",
    why: "the exchange is compared case-blind, so an 'MT5' key and an 'mt5' key on one login and server are one account",
    specs: [
      spec("k_a", "MT5", "L1010", "srv-a", true, OLD, "BTC", undefined, "mt5"),
      spec("k_b", "mt5", "L1010", "srv-a", false, NEW, "ETH"),
      Z,
    ],
  },
  {
    name: "marker-links-ambiguous-key",
    why: "a marker beats ambiguity: the no-server key marked against the srv-a key shares its account, srv-b stays its own",
    specs: [
      spec("k_t", "mt5", "L1011", "srv-a", true, OLD, "BTC"),
      spec("k_u", "mt5", "L1011", "srv-b", false, NEW, "ETH"),
      spec("k_n", "mt5", "L1011", null, false, NEW, "LTC", { kind: "duplicate", target: "k_t" }),
      Z,
    ],
  },
  {
    name: "marker-links-keyless-key",
    why: "marker edges feed known_account: two login-less keys, one marked against the other, are one account",
    specs: [
      spec("k_t", "mt5", null, null, true, OLD, "BTC"),
      spec("k_n", "mt5", null, null, true, NEW, "ETH", { kind: "duplicate", target: "k_t" }),
      Z,
    ],
  },
];

const toKeyDb = (s: Spec): KeyDb => ({
  id: s.id,
  user_id: ALLOCATOR,
  exchange: s.exchange,
  venue_account_id: s.login,
  venue_server: s.server,
  account_share_kind: s.marker?.kind ?? null,
  account_shared_with_api_key_id: s.marker?.target ?? null,
  live: s.live,
});

const holdingOf = (s: Spec) => ({
  allocator_id: ALLOCATOR,
  api_key_id: s.id,
  venue: s.venue,
  symbol: s.symbol,
  asof: s.day,
  holding_type: "spot",
  side: null,
  quantity: 1,
  mark_price: 100,
  value_usd: 100,
  entry_price: null,
  unrealized_pnl_usd: null,
  quantity_unit: null,
  updated_at: `${s.day}T04:00:00+00:00`,
});

/**
 * A hand-rolled client that answers each read of `fetchLatestHoldingsPerKey` from the
 * fixture, honouring eq, order and limit, and PROJECTING `api_keys` rows to the selected
 * columns (so a select that drops `venue_server` is observable). `audit_log` and
 * `allocator_equity_derived` are empty: no poll event or native-unpriced marker exists in
 * these fixtures.
 */
function fakeClient(keys: ReadonlyArray<KeyDb>, holdings: ReadonlyArray<Record<string, unknown>>) {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = [];
      let selected: string[] | null = null;
      let order: { column: string; ascending: boolean } | null = null;
      let limit: number | null = null;
      const chain = {
        select(cols?: string) {
          selected = cols && cols !== "*" ? cols.split(",").map((c) => c.trim()) : null;
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
              : table === "audit_log" || table === "allocator_equity_derived"
                ? []
                : holdings
          ) as Array<Record<string, unknown>>;
          let rows = source.filter((r) => eqs.every(([c, v]) => r[c] === v));
          if (order) {
            const { column: by, ascending } = order;
            rows = [...rows].sort(
              (a, b) => (String(a[by]) < String(b[by]) ? -1 : 1) * (ascending ? 1 : -1),
            );
          }
          if (limit !== null) rows = rows.slice(0, limit);
          if (table === "api_keys" && selected !== null) {
            const cols = selected;
            rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
          }
          resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  } as unknown as Parameters<typeof fetchLatestHoldingsPerKey>[0];
}

/** The browser's fingerprint for an arm: reader, then the payload derive, then the token set. */
async function clientFingerprint(
  specs: ReadonlyArray<Spec>,
  opts: { dropServers?: boolean } = {},
): Promise<string> {
  const keys = specs.map(toKeyDb).map((k) => (opts.dropServers ? { ...k, venue_server: null } : k));
  const holdings = specs.map(holdingOf);
  const read = await fetchLatestHoldingsPerKey(fakeClient(keys, holdings), ALLOCATOR, "*");
  expect(read.error).toBeNull();
  const apiKeys = keys.map((k) => ({
    id: k.id,
    is_active: true,
    exchange: k.exchange,
    sync_status: "complete",
    last_sync_at: "2026-11-10T04:00:00+00:00",
    disconnected_at: k.live ? null : "2026-11-10T05:00:00+00:00",
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

describe("PARITY-FINGERPRINT: the TypeScript fingerprint is the literal the SQL gate passes to the RPC (one login, many servers)", () => {
  it("the gate and this test name exactly the same arms, so a later SQL arm cannot skip the TypeScript replay", () => {
    const inGate = gateMarkers();
    expect(new Set(inGate).size, "a PARITY-FINGERPRINT name must be unique in the gate").toBe(inGate.length);
    expect([...inGate].sort()).toEqual(CASES.map((c) => c.name).sort());
  });

  for (const c of CASES) {
    it(`${c.name}: ${c.why}, and the fingerprint is the gate's literal`, async () => {
      expect(await clientFingerprint(c.specs)).toBe(gateLiteral(c.name));
    });
  }

  it("two-servers-two-accounts: without venue_server the two keys are one login-only account and the older srv-a row drops out, so the literal is not satisfied vacuously", async () => {
    const c = CASES.find((x) => x.name === "two-servers-two-accounts");
    expect(c).toBeDefined();
    const loginOnly = await clientFingerprint(c!.specs, { dropServers: true });
    expect(loginOnly).toBe("ETH:mt5:spot|SOL:okx:spot");
    expect(loginOnly).not.toBe(gateLiteral("two-servers-two-accounts"));
  });
});
