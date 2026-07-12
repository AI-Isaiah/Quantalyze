/**
 * Phase 94 / WIZ-01 — composite members GET route (web tier).
 *
 * THE phase's load-bearing security pin (94-VALIDATION.md "Security pin" row):
 * the owner-scoped member read is secretless BY CONSTRUCTION, so this suite
 * plants sentinel ciphertext on the mocked rows and proves neither the 5 secret
 * column NAMES nor their VALUES can ever serialize into the 200 body — even if
 * the DB read were somehow over-broad, the route's field-by-field response
 * build strips them.
 *
 * It also pins owner-scope (no existence oracle: not-found == not-owned → a
 * byte-identical 403), the 200 shape, the 400/403 error posture, empty
 * membership, and NO_STORE_HEADERS on success + error branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// Inbound correlation_id the wizard sends (UX-02) and DISPLAYS in the
// WIZARD_KEYS_LOAD_FAILED envelope. getCorrelationId() reads it from the
// request headers; the F-2 pin proves it reaches the error-path server log so a
// user copying the shown id can find the failure. Map.get() satisfies the
// headers() contract the helper uses.
const INBOUND_CORRELATION_ID = "wizard:11111111-1111-4111-8111-111111111111";
vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([["x-correlation-id", INBOUND_CORRELATION_ID]]),
}));

const MOCK_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as unknown as
  import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

// Resolution seams: maybeSingle() answers the ownership probe on `strategies`;
// order() answers the member read on `strategy_keys`.
const maybeSingleMock = vi.fn();
const orderMock = vi.fn();
const fromMock = vi.fn((table: string) => {
  if (table === "strategies") {
    const b = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => maybeSingleMock(),
    };
    return b;
  }
  if (table === "strategy_keys") {
    const b = {
      select: () => b,
      eq: () => b,
      order: () => orderMock(),
    };
    return b;
  }
  throw new Error(`unexpected table: ${table}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => fromMock(t) }),
}));

async function importGet() {
  const mod = await import("./route");
  return mod.GET;
}

const STRATEGY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_STRATEGY_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const AKID1 = "a1111111-1111-4111-8111-111111111111";
const AKID2 = "a2222222-2222-4222-8222-222222222222";

// The 5 secret/envelope column names that must NEVER serialize, and the sentinel
// ciphertext values planted on every mocked row (both at row level and on the
// embedded api_keys object) so an over-broad read would surface them.
const SECRET_COLUMNS = [
  "api_key_encrypted",
  "api_secret_encrypted",
  "passphrase_encrypted",
  "dek_encrypted",
  "nonce",
] as const;
const SENTINELS = [
  "SENTINEL_CT_1",
  "SENTINEL_CT_2",
  "SENTINEL_CT_3",
  "SENTINEL_CT_4",
  "SENTINEL_CT_5",
] as const;

function secretBag() {
  return {
    api_key_encrypted: "SENTINEL_CT_1",
    api_secret_encrypted: "SENTINEL_CT_2",
    passphrase_encrypted: "SENTINEL_CT_3",
    dek_encrypted: "SENTINEL_CT_4",
    nonce: "SENTINEL_CT_5",
  };
}

// Two members ordered by seq; each row carries planted secrets AND its embedded
// api_keys join also carries them — the worst-case over-broad read.
const LEAKY_ROWS = [
  {
    seq: 1,
    api_key_id: AKID1,
    window_start: "2025-08-01",
    window_end: "2025-10-01",
    api_keys: { exchange: "binance", label: "Main", ...secretBag() },
    ...secretBag(),
  },
  {
    seq: 2,
    api_key_id: AKID2,
    window_start: "2025-10-01",
    window_end: null, // live member — passes through as null
    api_keys: { exchange: "bybit", label: "Backup", ...secretBag() },
    ...secretBag(),
  },
];

function makeReq(query: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/strategies/composite/members${query}`,
    { method: "GET" },
  );
}

function resetMocks() {
  fromMock.mockClear();
  maybeSingleMock.mockReset();
  orderMock.mockReset();
  // Default: caller IS the owner.
  maybeSingleMock.mockResolvedValue({ data: { id: STRATEGY_ID }, error: null });
  orderMock.mockResolvedValue({ data: LEAKY_ROWS, error: null });
}

describe("GET /api/strategies/composite/members — no-secret-leak pin (T-94-01)", () => {
  beforeEach(resetMocks);

  it("NEVER serializes any of the 5 secret column NAMES or VALUES, even from over-broad rows", async () => {
    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    const serialized = JSON.stringify(body);

    // The load-bearing assertion: neither the column names nor the sentinel
    // ciphertext values appear anywhere in the serialized response.
    for (const name of SECRET_COLUMNS) {
      expect(serialized).not.toContain(name);
    }
    for (const sentinel of SENTINELS) {
      expect(serialized).not.toContain(sentinel);
    }
  });
});

describe("GET /api/strategies/composite/members — 200 shape + ordering", () => {
  beforeEach(resetMocks);

  it("returns owner-scoped member metadata field-by-field, ordered by seq, live window null", async () => {
    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      members: [
        {
          seq: 1,
          api_key_id: AKID1,
          exchange: "binance",
          nickname: "Main",
          window_start: "2025-08-01",
          window_end: "2025-10-01",
          verified: true,
        },
        {
          seq: 2,
          api_key_id: AKID2,
          exchange: "bybit",
          nickname: "Backup",
          window_start: "2025-10-01",
          window_end: null,
          verified: true,
        },
      ],
    });

    // Ordered read: strategy_keys queried after the ownership probe.
    expect(fromMock.mock.calls.map((c) => c[0])).toEqual([
      "strategies",
      "strategy_keys",
    ]);
  });

  it("owned strategy with zero members → 200 { ok: true, members: [] }", async () => {
    orderMock.mockResolvedValue({ data: [], error: null });

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, members: [] });
  });
});

describe("GET /api/strategies/composite/members — owner-scope, no existence oracle (T-94-02/03)", () => {
  beforeEach(resetMocks);

  it("not-owned/not-found → 403 { code: UNKNOWN }; the strategy_keys read is NEVER issued", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: "UNKNOWN" });
    // Member read short-circuited: strategy_keys builder never created,
    // member-read seam never fired.
    expect(fromMock.mock.calls.map((c) => c[0])).not.toContain("strategy_keys");
    expect(orderMock).not.toHaveBeenCalled();
  });

  it("non-existent and not-owned produce BYTE-IDENTICAL 403 responses (no oracle)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    const GET = await importGet();
    const resA = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));
    const resB = await GET(makeReq(`?strategy_id=${OTHER_STRATEGY_ID}`));

    expect(resA.status).toBe(403);
    expect(resB.status).toBe(403);
    expect(JSON.stringify(await resA.json())).toBe(
      JSON.stringify(await resB.json()),
    );
  });
});

describe("GET /api/strategies/composite/members — inbound correlation_id is logged on error paths (F-2)", () => {
  beforeEach(resetMocks);

  it("member-read 500 logs the inbound X-Correlation-Id (findable in server logs)", async () => {
    orderMock.mockResolvedValue({
      data: null,
      error: { message: "boom: member read failed" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(500);
    // The displayed id must appear in the error log so a user copying it from
    // the WIZARD_KEYS_LOAD_FAILED envelope can find THIS failure server-side.
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(INBOUND_CORRELATION_ID);
    expect(logged).toContain("member read error");

    errSpy.mockRestore();
  });

  it("ownership-probe 500 logs the inbound X-Correlation-Id", async () => {
    maybeSingleMock.mockResolvedValue({
      data: null,
      error: { message: "boom: ownership probe failed" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(500);
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(INBOUND_CORRELATION_ID);

    errSpy.mockRestore();
  });

  it("caught-exception 500 logs the inbound X-Correlation-Id", async () => {
    orderMock.mockRejectedValue(new Error("boom: unexpected throw"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(res.status).toBe(500);
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(INBOUND_CORRELATION_ID);

    errSpy.mockRestore();
  });

  it("does NOT leak the correlation id into the 500 response body (no-leak posture holds)", async () => {
    orderMock.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));

    expect(await res.json()).toEqual({ code: "UNKNOWN" });

    errSpy.mockRestore();
  });
});

describe("GET /api/strategies/composite/members — input + cache posture", () => {
  beforeEach(resetMocks);

  it("missing strategy_id → 400 { code: UNKNOWN }; no DB read issued", async () => {
    const GET = await importGet();
    const res = await GET(makeReq(""));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "UNKNOWN" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("malformed (non-UUID) strategy_id → 400 { code: UNKNOWN }; no DB read issued", async () => {
    const GET = await importGet();
    const res = await GET(makeReq("?strategy_id=not-a-uuid"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "UNKNOWN" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("NO_STORE_HEADERS (Cache-Control: private, no-store) on the 200 AND the 403", async () => {
    const GET = await importGet();
    const ok = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");

    maybeSingleMock.mockResolvedValue({ data: null, error: null });
    const forbidden = await GET(makeReq(`?strategy_id=${STRATEGY_ID}`));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
