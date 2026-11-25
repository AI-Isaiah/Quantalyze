/**
 * Phase 225 plan 06 (CONN-03, MT5D-08). The TS half of the broker-server
 * identity rule, replayed against the case table the Python twin reads too
 * (`analytics-service/tests/fixtures/venue_server_identity.json`). The
 * expectations in that file are hand-typed; nothing here derives one from the
 * code under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

const auditMock = vi.hoisted(() => ({ logAuditEventAsUser: vi.fn() }));
vi.mock("@/lib/audit", () => auditMock);

import {
  accountIdentityTokens,
  ambiguousServerKeyIds,
  type DepartedHistoryKey,
} from "./departed-history";
import {
  MAX_VENUE_SERVER_LENGTH,
  afterSlotSwap,
  normaliseConnectedVenueServer,
  normaliseVenueServer,
  pickSameAccountHolder,
  readLiveSameLoginKeys,
  sameVenueServer,
  swapAccountSlot,
} from "./venue-identity";

type TokenKey = {
  id: string;
  exchange: string;
  venue_account_id: string | null;
  venue_server: string | null;
  account_shared_with_api_key_id?: string | null;
  account_share_kind?: string | null;
  disconnected_at?: string | null;
};

type TokenCase = {
  name: string;
  keys: TokenKey[];
  tokens: Record<string, string | null>;
  ambiguous: string[];
};

type PickCase = {
  name: string;
  rows: Array<{ id: string; venue_server: string | null }>;
  server: string | null;
  mode: "fence" | "after_index_refusal";
  expect: string | null;
};

const spec = JSON.parse(
  readFileSync(
    path.resolve(
      process.cwd(),
      "analytics-service/tests/fixtures/venue_server_identity.json",
    ),
    "utf8",
  ),
) as {
  normalise: Array<{ in: unknown; out: string | null }>;
  connect: Array<{ raw: string; stored: string | null }>;
  same: Array<{ a: string | null; b: string | null; same: boolean }>;
  pick: PickCase[];
  tokens: TokenCase[];
};

describe("the shared fixture is not vacuous", () => {
  it("holds cases in every array", () => {
    expect(spec.normalise.length).toBeGreaterThan(0);
    expect(spec.connect.length).toBeGreaterThan(0);
    expect(spec.same.length).toBeGreaterThan(0);
    expect(spec.pick.length).toBeGreaterThan(0);
    expect(spec.tokens.length).toBeGreaterThan(0);
  });
});

describe("normaliseConnectedVenueServer (the fixture's end-to-end connect cases, WR-03)", () => {
  // The Python poll normalises what `parse_mt5_credentials` already stripped with
  // `str.strip()`. The connect routes must store that same value, or one broker
  // server is two identities depending on which writer stamped the row.
  it.each(spec.connect)("raw $raw is stored as $stored", ({ raw, stored }) => {
    expect(normaliseConnectedVenueServer(raw)).toBe(stored);
  });

  it("a no-break-space-padded server is the SAME stored value the Python poll captures", () => {
    expect(normaliseConnectedVenueServer("MetaQuotes-Demo\u00a0")).toBe(
      normaliseConnectedVenueServer("MetaQuotes-Demo"),
    );
    // The function-level form is deliberately unchanged: it keeps the no-break
    // space the database CHECK keeps, which is why the routes need the strip.
    expect(normaliseVenueServer("MetaQuotes-Demo\u00a0")).toBe("metaquotes-demo\u00a0");
  });

  it("is total: a non-string is null, never stringified", () => {
    expect(normaliseConnectedVenueServer(5)).toBeNull();
    expect(normaliseConnectedVenueServer(null)).toBeNull();
    expect(normaliseConnectedVenueServer(undefined)).toBeNull();
  });
});

describe("normaliseVenueServer (the fixture's cases)", () => {
  it.each(spec.normalise)("$in normalises to $out", ({ in: raw, out }) => {
    expect(normaliseVenueServer(raw)).toBe(out);
  });

  it("counts code points like the database's char_length, not UTF-16 units", () => {
    expect(MAX_VENUE_SERVER_LENGTH).toBe(128);
    expect(normaliseVenueServer("\u{1F600}".repeat(128))).toBe("\u{1F600}".repeat(128));
    expect(normaliseVenueServer("\u{1F600}".repeat(129))).toBeNull();
  });
});

describe("sameVenueServer (the fixture's cases)", () => {
  it.each(spec.same)("$a vs $b is same=$same", ({ a, b, same }) => {
    expect(sameVenueServer(a, b)).toBe(same);
  });
});

describe("pickSameAccountHolder (the fixture's cases)", () => {
  it.each(spec.pick)("$name", ({ rows, server, mode, expect: want }) => {
    expect(pickSameAccountHolder(rows, server, mode)?.id ?? null).toBe(want);
  });

  it.each(spec.pick)("$name (rows reversed)", ({ rows, server, mode, expect: want }) => {
    expect(pickSameAccountHolder([...rows].reverse(), server, mode)?.id ?? null).toBe(want);
  });
});

// The TS twin of Python `account_identity_tokens` / `ambiguous_server_key_ids`
// (225 plan 14, plan 15). Every non-identity field of DepartedHistoryKey is null.
const toHistoryKey = (k: TokenKey): DepartedHistoryKey => ({
  id: k.id,
  exchange: k.exchange,
  venue_account_id: k.venue_account_id,
  venue_server: k.venue_server,
  account_shared_with_api_key_id: k.account_shared_with_api_key_id ?? null,
  account_share_kind: k.account_share_kind ?? null,
  disconnected_at: k.disconnected_at ?? null,
  sync_status: null,
  history_inclusion: null,
  first_returns_day: null,
  last_returns_day: null,
});

describe("accountIdentityTokens and ambiguousServerKeyIds (the fixture's tokens cases)", () => {
  const replay = (keys: TokenKey[], want: TokenCase) => {
    const historyKeys = keys.map(toHistoryKey);
    expect(Object.fromEntries(accountIdentityTokens(historyKeys))).toEqual(want.tokens);
    expect([...ambiguousServerKeyIds(historyKeys)].sort()).toEqual([...want.ambiguous].sort());
  };

  it.each(spec.tokens)("$name", (c) => {
    replay(c.keys, c);
  });

  it.each(spec.tokens)("$name (rows reversed)", (c) => {
    replay([...c.keys].reverse(), c);
  });
});

// ---------------------------------------------------------------------------
// readLiveSameLoginKeys and swapAccountSlot, against a recorded-call admin mock.
// ---------------------------------------------------------------------------

type Call = [method: string, ...args: unknown[]];

/** An admin client whose query chain records every call and resolves to `result`. */
function readAdmin(result: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === "order" ? Promise.resolve(result) : chain;
    };
  }
  const admin = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

/** An admin client whose rpc answers per function name and records each call. */
function rpcAdmin(
  answers: Record<string, { error: unknown } | (() => never)>,
) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const admin = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const answer = answers[fn];
      if (typeof answer === "function") return answer();
      return Promise.resolve({ data: null, ...(answer ?? { error: null }) });
    },
  } as unknown as SupabaseClient;
  return { admin, rpcCalls };
}

const OWNER = "owner-0001";
const NEW_KEY = "key-new";
const OLD_HOLDER = "key-old";
const SWAP_ARGS = {
  userId: OWNER,
  exchange: "mt5",
  newKeyId: NEW_KEY,
  oldHolderId: OLD_HOLDER,
  venueAccountId: "123456",
  venueServer: "srv-a" as string | null,
};

afterEach(() => {
  auditMock.logAuditEventAsUser.mockReset();
  vi.restoreAllMocks();
});

describe("readLiveSameLoginKeys", () => {
  const args = { userId: OWNER, exchange: "mt5", venueAccountId: "123456" };

  it("filters on owner, exchange, login and liveness, selects exactly the seven columns, orders by id", async () => {
    const { admin, calls } = readAdmin({ data: [], error: null });
    await readLiveSameLoginKeys(admin, args);
    expect(calls).toEqual([
      ["from", "api_keys"],
      [
        "select",
        "id, venue_server, is_active, sync_status, disconnected_at, account_shared_with_api_key_id, account_share_kind",
      ],
      ["eq", "user_id", OWNER],
      ["eq", "exchange", "mt5"],
      ["eq", "venue_account_id", "123456"],
      ["is", "disconnected_at", null],
      ["order", "id"],
    ]);
  });

  it("returns the rows it read", async () => {
    const row = {
      id: "k-001",
      venue_server: "srv-a",
      is_active: true,
      sync_status: null,
      disconnected_at: null,
      account_shared_with_api_key_id: null,
      account_share_kind: null,
    };
    const { admin } = readAdmin({ data: [row], error: null });
    expect(await readLiveSameLoginKeys(admin, args)).toEqual({ rows: [row], error: null });
  });

  it("returns the read error instead of throwing, with no rows", async () => {
    const boom = { code: "57014", message: "carries a login 123456" };
    const { admin } = readAdmin({ data: null, error: boom });
    expect(await readLiveSameLoginKeys(admin, args)).toEqual({ rows: [], error: boom });
  });

  it("does not log the error (the caller scrubs it with its own secrets)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = readAdmin({ data: null, error: { code: "x", message: "123456" } });
    await readLiveSameLoginKeys(admin, args);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("swapAccountSlot", () => {
  it("calls swap_account_slot with the login and the server explicitly", async () => {
    const { admin, rpcCalls } = rpcAdmin({});
    const res = await swapAccountSlot(admin, SWAP_ARGS);
    expect(res).toEqual({ ok: true });
    expect(rpcCalls[0]).toEqual({
      fn: "swap_account_slot",
      args: {
        p_new_key: NEW_KEY,
        p_old_holder: OLD_HOLDER,
        p_venue_account_id: "123456",
        p_venue_server: "srv-a",
      },
    });
  });

  it("leaves p_venue_server out when the server is null, so the RPC keeps the holder's", async () => {
    const { admin, rpcCalls } = rpcAdmin({});
    await swapAccountSlot(admin, { ...SWAP_ARGS, venueServer: null });
    expect(rpcCalls[0].args).not.toHaveProperty("p_venue_server");
  });

  it("sends a blank or over-length server as no server, never as a refusal", async () => {
    const { admin, rpcCalls } = rpcAdmin({});
    await swapAccountSlot(admin, { ...SWAP_ARGS, venueServer: "  \t " });
    await swapAccountSlot(admin, { ...SWAP_ARGS, venueServer: "x".repeat(129) });
    expect(rpcCalls.filter((c) => c.fn === "swap_account_slot").every((c) => !("p_venue_server" in c.args))).toBe(true);
  });

  it("audits the DEMOTED key with the venue and the new holder's id only, then asks for a recompose", async () => {
    const { admin, rpcCalls } = rpcAdmin({});
    await swapAccountSlot(admin, SWAP_ARGS);
    expect(auditMock.logAuditEventAsUser).toHaveBeenCalledTimes(1);
    expect(auditMock.logAuditEventAsUser).toHaveBeenCalledWith(admin, OWNER, {
      action: "api_key.account_duplicate_detected",
      entity_type: "api_key",
      entity_id: OLD_HOLDER,
      metadata: { venue: "mt5", holder_api_key_id: NEW_KEY },
    });
    expect(rpcCalls[1]).toEqual({
      fn: "enqueue_compute_job",
      args: { p_strategy_id: null, p_allocator_id: OWNER, p_kind: "derive_allocator_equity" },
    });
  });

  it("afterSlotSwap alone audits the demoted key and asks for a recompose, with no swap RPC (the routes call it for a swap that landed and lost its answer)", async () => {
    const { admin, rpcCalls } = rpcAdmin({});
    await afterSlotSwap(admin, {
      userId: OWNER,
      exchange: "mt5",
      newKeyId: NEW_KEY,
      oldHolderId: OLD_HOLDER,
    });
    expect(auditMock.logAuditEventAsUser).toHaveBeenCalledWith(admin, OWNER, {
      action: "api_key.account_duplicate_detected",
      entity_type: "api_key",
      entity_id: OLD_HOLDER,
      metadata: { venue: "mt5", holder_api_key_id: NEW_KEY },
    });
    expect(rpcCalls).toEqual([
      {
        fn: "enqueue_compute_job",
        args: { p_strategy_id: null, p_allocator_id: OWNER, p_kind: "derive_allocator_equity" },
      },
    ]);
  });

  it("returns { ok: false, error } on an RPC error and neither audits nor enqueues", async () => {
    const refusal = { code: "55000", message: "ACCOUNT_SLOT_HOLDER_WORKING" };
    const { admin, rpcCalls } = rpcAdmin({ swap_account_slot: { error: refusal } });
    expect(await swapAccountSlot(admin, SWAP_ARGS)).toEqual({ ok: false, error: refusal });
    expect(auditMock.logAuditEventAsUser).not.toHaveBeenCalled();
    expect(rpcCalls.map((c) => c.fn)).toEqual(["swap_account_slot"]);
  });

  it("returns { ok: false } when the RPC call throws, without auditing", async () => {
    const boom = new Error("fetch failed");
    const { admin } = rpcAdmin({
      swap_account_slot: () => {
        throw boom;
      },
    });
    expect(await swapAccountSlot(admin, SWAP_ARGS)).toEqual({ ok: false, error: boom });
    expect(auditMock.logAuditEventAsUser).not.toHaveBeenCalled();
  });

  it("logs an enqueue error and still returns ok: the swap has landed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = rpcAdmin({
      enqueue_compute_job: { error: { code: "XX000", message: "login 123456 leaked" } },
    });
    expect(await swapAccountSlot(admin, SWAP_ARGS)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = String(spy.mock.calls[0].join(" "));
    expect(logged).toContain(OLD_HOLDER);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("srv-a");
  });

  it("logs a thrown enqueue and still returns ok", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin } = rpcAdmin({
      enqueue_compute_job: () => {
        throw new Error("fetch failed for 123456");
      },
    });
    expect(await swapAccountSlot(admin, SWAP_ARGS)).toEqual({ ok: true });
    expect(String(spy.mock.calls[0].join(" "))).not.toContain("123456");
  });
});
