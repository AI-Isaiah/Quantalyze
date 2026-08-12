/**
 * Phase 154 / WIZCONT-01 — GET /api/strategies/wizard-draft.
 *
 * WHAT THIS SUITE PINS (Rule 9 — the WHY, not just the WHAT):
 *
 *  - The route drives the REAL `readLatestWizardDraft` helper against a mocked
 *    postgrest client. The helper has its own unit tests; what could still
 *    break — and what a helper-only test cannot catch — is the WIRING: that
 *    this route actually calls it, with the CALLER'S id, and translates each of
 *    its three outcomes (row / no row / error) into the right response.
 *  - Absent draft is a FACT, not an error → 200 `{draft:null, kind:null}`. If
 *    this ever became a 4xx the overlay could not tell "no draft" from "broken
 *    read", and would show an error where a fresh wizard belongs.
 *  - An UNKNOWABLE membership count fails CLOSED (500), never a guessed branch.
 *  - No raw DB message ever reaches the body (H-0305); the inbound
 *    correlation_id reaches the LOG so a reported failure is findable.
 *  - `Cache-Control: private, no-store` on EVERY arm (Block D / P1947): the
 *    body carries one tenant's draft.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const INBOUND_CORRELATION_ID = "wizard:11111111-1111-4111-8111-111111111111";
vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-correlation-id", INBOUND_CORRELATION_ID]]),
}));

const MOCK_USER = {
  id: "00000000-0000-0000-0000-aaaaaaaaaaaa",
} as unknown as import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

// Resolution seams: maybeSingle() answers the draft read on `strategies`; the
// head-count probe on `strategy_keys` is awaited directly (thenable).
const draftReadMock = vi.fn();
const memberCountMock = vi.fn();
const eqCalls: Array<[string, unknown]> = [];

const fromMock = vi.fn((table: string) => {
  const record = (col: string, val: unknown) => {
    eqCalls.push([col, val]);
  };
  if (table === "strategies") {
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        record(c, v);
        return b;
      },
      order: () => b,
      limit: () => b,
      maybeSingle: () => draftReadMock(),
    };
    return b;
  }
  if (table === "strategy_keys") {
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        record(c, v);
        return b;
      },
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve(memberCountMock()).then(onFulfilled),
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

function makeReq(): NextRequest {
  return new NextRequest("http://localhost/api/strategies/wizard-draft", {
    method: "GET",
  });
}

const DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const API_KEY_ID = "a1111111-1111-4111-8111-111111111111";

/**
 * The 5 secret/envelope column names that must NEVER serialize, planted on the
 * mocked row so an over-broad read (or a future `...draft` spread) would
 * surface them. HAND-TYPED, not imported.
 */
const SECRET_COLUMNS = [
  "api_key_encrypted",
  "api_secret_encrypted",
  "passphrase_encrypted",
  "dek_encrypted",
  "nonce",
] as const;

function leakyDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    name: "Resumable draft",
    description: "desc",
    category_id: "cat-1",
    strategy_types: ["systematic"],
    subtypes: ["trend"],
    markets: ["crypto"],
    supported_exchanges: ["binance"],
    leverage_range: "1-2x",
    aum: 1000,
    max_capacity: 5000,
    api_key_id: API_KEY_ID,
    asset_class: "crypto",
    // The ORDER key — selected, but deliberately NOT part of InitialDraft.
    created_at: "2026-08-01T00:00:00Z",
    // Planted ciphertext (worst-case over-broad read).
    api_key_encrypted: "SENTINEL_CT_1",
    api_secret_encrypted: "SENTINEL_CT_2",
    passphrase_encrypted: "SENTINEL_CT_3",
    dek_encrypted: "SENTINEL_CT_4",
    nonce: "SENTINEL_CT_5",
    ...overrides,
  };
}

function resetMocks() {
  fromMock.mockClear();
  eqCalls.length = 0;
  draftReadMock.mockReset();
  memberCountMock.mockReset();
  draftReadMock.mockResolvedValue({ data: leakyDraftRow(), error: null });
  memberCountMock.mockResolvedValue({ count: 0, error: null });
}

describe("GET /api/strategies/wizard-draft — happy path", () => {
  beforeEach(resetMocks);

  it("returns the caller's own latest draft, projected field-by-field, with its kind", async () => {
    const GET = await importGet();
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      draft: {
        id: DRAFT_ID,
        name: "Resumable draft",
        description: "desc",
        category_id: "cat-1",
        strategy_types: ["systematic"],
        subtypes: ["trend"],
        markets: ["crypto"],
        supported_exchanges: ["binance"],
        leverage_range: "1-2x",
        aum: 1000,
        max_capacity: 5000,
        api_key_id: API_KEY_ID,
        asset_class: "crypto",
      },
      kind: "api",
    });
  });

  it("scopes the read to the AUTHENTICATED caller — no id parameter, no enumeration", async () => {
    const GET = await importGet();
    await GET(makeReq());

    expect(eqCalls).toEqual([
      ["user_id", MOCK_USER.id],
      ["source", "wizard"],
      ["status", "draft"],
    ]);
  });

  it("NEVER serializes a secret column name or its value, even from an over-broad row", async () => {
    const GET = await importGet();
    const res = await GET(makeReq());
    const serialized = JSON.stringify(await res.json());

    for (const name of SECRET_COLUMNS) {
      expect(serialized).not.toContain(name);
    }
    for (const sentinel of [
      "SENTINEL_CT_1",
      "SENTINEL_CT_2",
      "SENTINEL_CT_3",
      "SENTINEL_CT_4",
      "SENTINEL_CT_5",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    // The ORDER key is not part of the wizard's hydration contract either.
    expect(serialized).not.toContain("created_at");
  });

  it("a keyless draft with members resolves as COMPOSITE (the probe is wired through)", async () => {
    draftReadMock.mockResolvedValue({
      data: leakyDraftRow({ api_key_id: null }),
      error: null,
    });
    memberCountMock.mockResolvedValue({ count: 2, error: null });

    const GET = await importGet();
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.kind).toBe("composite");
    expect(eqCalls).toContainEqual(["strategy_id", DRAFT_ID]);
  });

  it("a keyless draft with ZERO members is withheld — 200 {draft:null, kind:null}, never kind 'csv'", async () => {
    // ⭐ THE REGRESSION PIN, at the wire the overlay actually reads. This is the
    // state of EVERY composite draft during the add-keys phase:
    // `add_wizard_composite_key` writes strategies + api_keys and no
    // strategy_keys row (only set_wizard_composite_members does, on the
    // multi-key step's Continue).
    //
    // Answering `kind: "csv"` here was the first link of a destructive chain:
    // ContributionWizardOverlay:138 force-switches the tab on that exact string,
    // WizardClient:243-245 seeds `strategyId` from the draft, and "Start fresh"
    // DELETEs it (WizardClient:819) — so a founder who clicked "+ Strategy"
    // landed on CSV upload and was offered a button that destroyed their
    // composite draft. Both the id and the string must stay off the wire.
    draftReadMock.mockResolvedValue({
      data: leakyDraftRow({ api_key_id: null }),
      error: null,
    });
    memberCountMock.mockResolvedValue({ count: 0, error: null });

    const GET = await importGet();
    const res = await GET(makeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ draft: null, kind: null });
    expect(JSON.stringify(body)).not.toContain(DRAFT_ID);
    // The probe DID run — this is a measured answer, not a skipped read.
    expect(eqCalls).toContainEqual(["strategy_id", DRAFT_ID]);
  });
});

describe("GET /api/strategies/wizard-draft — absence is a fact, not an error", () => {
  beforeEach(resetMocks);

  it("no draft → 200 { draft: null, kind: null }", async () => {
    draftReadMock.mockResolvedValue({ data: null, error: null });

    const GET = await importGet();
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: null, kind: null });
  });
});

describe("GET /api/strategies/wizard-draft — error posture (H-0305)", () => {
  beforeEach(resetMocks);

  it("a draft-read DB error → 500 { code: UNKNOWN }; the raw message never reaches the body", async () => {
    draftReadMock.mockResolvedValue({
      data: null,
      error: { message: "boom: relation strategies does not exist" },
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq());
    const serialized = JSON.stringify(await res.json());

    expect(res.status).toBe(500);
    expect(serialized).toBe(JSON.stringify({ code: "UNKNOWN" }));
    expect(serialized).not.toContain("boom");

    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(INBOUND_CORRELATION_ID);
    expect(logged).toContain("draft read error");

    errSpy.mockRestore();
  });

  it("an UNKNOWABLE membership count fails CLOSED → 500, never a guessed branch", async () => {
    draftReadMock.mockResolvedValue({
      data: leakyDraftRow({ api_key_id: null }),
      error: null,
    });
    // A null count with NO error — PostgREST can answer this way.
    memberCountMock.mockResolvedValue({ count: null, error: null });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "UNKNOWN" });
    expect(
      errSpy.mock.calls.map((c) => String(c[0])).join("\n"),
    ).toContain(INBOUND_CORRELATION_ID);

    errSpy.mockRestore();
  });

  it("an unexpected throw → 500 { code: UNKNOWN } with the correlation id logged", async () => {
    draftReadMock.mockRejectedValue(new Error("boom: unexpected throw"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const GET = await importGet();
    const res = await GET(makeReq());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("boom");
    const logged = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain(INBOUND_CORRELATION_ID);
    expect(logged).toContain("caught exception");

    errSpy.mockRestore();
  });
});

describe("GET /api/strategies/wizard-draft — cache posture", () => {
  beforeEach(resetMocks);

  it("Cache-Control: private, no-store on the 200-with-draft, the 200-null and the 500", async () => {
    const GET = await importGet();

    const withDraft = await GET(makeReq());
    expect(withDraft.status).toBe(200);
    expect(withDraft.headers.get("Cache-Control")).toBe("private, no-store");

    draftReadMock.mockResolvedValue({ data: null, error: null });
    const empty = await GET(makeReq());
    expect(empty.status).toBe(200);
    expect(empty.headers.get("Cache-Control")).toBe("private, no-store");

    draftReadMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await GET(makeReq());
    expect(failed.status).toBe(500);
    expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
    errSpy.mockRestore();
  });
});
