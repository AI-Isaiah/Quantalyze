/**
 * Regression tests for audit findings H-0305, H-0308, H-0310.
 *
 * H-0305 — Raw error message must not reach the client response body.
 *   The catch block previously returned `{ code, error: message }` where
 *   `message` contained the raw Railway/exchange string. That string can
 *   include partial secrets ("Binance rejected key abcd1234...") or
 *   internal service details. Only `{ code }` may be returned.
 *
 * H-0308 — encryptKey() is already Zod-validated via EncryptKeyResponseSchema.
 *   The route previously re-cast the typed return as `Record<string,unknown>`
 *   and then re-cast each field individually as `string|undefined`. This strips
 *   the static type contract, making Python service shape drift invisible to TS.
 *   The route must consume the typed return directly.
 *
 * H-0310 — HTTP 400 is wrong for upstream failures.
 *   A 400 means "client sent bad data". When the analytics-service or exchange
 *   is unreachable/rate-limiting, the correct status is 502 (bad gateway) or
 *   503 (service unavailable). Dashboards and SLO consumers cannot distinguish
 *   "user typed the wrong secret" from "Railway is down" when everything is 400.
 *   Fixed status map:
 *     KEY_INVALID_SIGNATURE → 400  (client error: wrong secret)
 *     KEY_IP_ALLOWLIST      → 502  (upstream rejected the probe)
 *     KEY_RATE_LIMIT        → 503  (upstream throttling)
 *     KEY_NETWORK_TIMEOUT   → 502  (analytics-service unreachable)
 *     UNKNOWN               → 500  (unclassified server fault)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const MOCK_USER = { id: "00000000-0000-0000-0000-bbbbbbbbbbbb" } as unknown as
  import("@supabase/supabase-js").User;

vi.mock("@/lib/api/withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
}));

const validateKeyMock = vi.fn();
const encryptKeyMock = vi.fn();
vi.mock("@/lib/analytics-client", () => ({
  validateKey: (...args: unknown[]) => validateKeyMock(...args),
  encryptKey: (...args: unknown[]) => encryptKeyMock(...args),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

// Import AFTER mocks so module init reads the mocked deps.
async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const WIZARD_SESSION_ID = "22222222-3333-4444-8555-666666666666";
const STRATEGY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const API_KEY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const VALID_BODY = {
  exchange: "binance",
  api_key: "binance-key-with-enough-chars",
  api_secret: "binance-secret-with-enough-chars",
  label: "audit regression key",
  wizard_session_id: WIZARD_SESSION_ID,
};

// Matches EncryptKeyResponseSchema contract:
//   api_key_encrypted: string (required)
//   api_secret_encrypted: string | null (envelope-encryption: null by design)
//   passphrase_encrypted: string | null
//   dek_encrypted: string (required — wraps the per-row DEK)
//   nonce: string | null
//   kek_version: number
// Note: the mock bypasses the actual Zod parse in encryptKey(); we supply
// a schema-valid shape so tests exercise the route's field forwarding faithfully.
const VALID_ENCRYPTED_PAYLOAD = {
  api_key_encrypted: "encrypted-blob-base64",
  api_secret_encrypted: null,
  passphrase_encrypted: null,
  dek_encrypted: "dek-encrypted-base64",
  nonce: null,
  kek_version: 1,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/strategies/create-with-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// H-0305 — Raw message must not appear in the response body
// ---------------------------------------------------------------------------
describe("H-0305 — catch block must not forward raw Railway message to client", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
  });

  it("does not include the raw error message in the JSON body when validateKey throws", async () => {
    const secretContents = "BINANCE-rejected-key-abc123-secret-fragment";
    validateKeyMock.mockRejectedValue(new Error(`Exchange error: ${secretContents}`));

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    const json = await res.json();

    // The 'error' field must be absent — raw message must not leak.
    expect(json).not.toHaveProperty("error");
    // The 'code' field must be present so the client can branch on it.
    expect(json).toHaveProperty("code");
    // Critical: the secret fragment must not appear anywhere in the serialized body.
    expect(JSON.stringify(json)).not.toContain(secretContents);

    consoleErr.mockRestore();
  });

  it("logs the raw message server-side (console.error) even though it's not forwarded", async () => {
    const rawMsg = "internal-service-detail-ETIMEDOUT";
    validateKeyMock.mockRejectedValue(new Error(rawMsg));

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const POST = await importPost();
    await POST(makeReq(VALID_BODY));

    // The raw message IS logged server-side for observability.
    expect(consoleErr).toHaveBeenCalledWith(
      expect.stringContaining("caught exception"),
      expect.stringContaining(rawMsg),
    );
    consoleErr.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// H-0308 — encryptKey() typed return is used without unsafe casts
// ---------------------------------------------------------------------------
describe("H-0308 — encryptKey typed return used directly (no Record<string,unknown> cast)", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();

    validateKeyMock.mockResolvedValue({
      valid: true,
      read_only: true,
      permissions: ["read"],
    });

    rpcMock.mockResolvedValue({
      data: [{ strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID }],
      error: null,
    });
  });

  it("passes typed encrypted fields to the RPC with no undefined coercion", async () => {
    // The EncryptKeyResponseSchema-typed payload: api_key_encrypted is
    // required (string), all others are nullable. The route must forward
    // these to create_wizard_strategy without stripping types via `as`.
    encryptKeyMock.mockResolvedValue(VALID_ENCRYPTED_PAYLOAD);

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const [, rpcArgs] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];

    // Required field: must be the exact string from the encrypted payload.
    expect(rpcArgs.p_api_key_encrypted).toBe("encrypted-blob-base64");
    // Nullable envelope fields: null → null (not undefined, not "null" string).
    expect(rpcArgs.p_api_secret_encrypted).toBeNull();
    expect(rpcArgs.p_passphrase_encrypted).toBeNull();
    // dek_encrypted is required (non-nullable per schema): must be forwarded as-is.
    expect(rpcArgs.p_dek_encrypted).toBe("dek-encrypted-base64");
    // nonce: nullable per schema, null in this payload.
    expect(rpcArgs.p_nonce).toBeNull();
    // kek_version: numeric from payload → numeric to RPC.
    expect(rpcArgs.p_kek_version).toBe(1);
  });

  it("passes dek_encrypted and nonce correctly when the service provides them", async () => {
    encryptKeyMock.mockResolvedValue({
      ...VALID_ENCRYPTED_PAYLOAD,
      dek_encrypted: "real-dek-ciphertext",
      nonce: "real-nonce-value",
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const [, rpcArgs] = rpcMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcArgs.p_dek_encrypted).toBe("real-dek-ciphertext");
    expect(rpcArgs.p_nonce).toBe("real-nonce-value");
  });
});

// ---------------------------------------------------------------------------
// H-0310 — Status codes: client faults → 400, upstream faults → 502/503
// ---------------------------------------------------------------------------
describe("H-0310 — catch block returns correct HTTP status per error class", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
  });

  const consoleErrSpy = () =>
    vi.spyOn(console, "error").mockImplementation(() => {});

  it("KEY_INVALID_SIGNATURE → 400 (client error: wrong secret)", async () => {
    // Wrong secret is a client fault — the client supplied bad credentials.
    validateKeyMock.mockRejectedValue(new Error("invalid secret for exchange"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("KEY_INVALID_SIGNATURE");
    spy.mockRestore();
  });

  it("KEY_IP_ALLOWLIST → 502 (exchange rejected probe from our IP)", async () => {
    // IP allowlist failure is an upstream policy reject — the exchange server
    // blocked our probe because our server IP is not whitelisted.
    validateKeyMock.mockRejectedValue(new Error("ip not in allow list"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("KEY_IP_ALLOWLIST");
    spy.mockRestore();
  });

  it("KEY_RATE_LIMIT → 503 (exchange or Railway throttling)", async () => {
    // Rate-limit from exchange/Railway is a temporary upstream throttle.
    // 503 tells clients and SLO monitors to back off and retry.
    validateKeyMock.mockRejectedValue(new Error("rate limit exceeded 429"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe("KEY_RATE_LIMIT");
    spy.mockRestore();
  });

  it("KEY_NETWORK_TIMEOUT → 502 (analytics-service unreachable)", async () => {
    // Network timeout means analytics-service (or upstream exchange) is down.
    // 502 is correct: we are the gateway, upstream failed to respond.
    // (Pre-fix this returned 400, indistinguishable from a bad secret.)
    validateKeyMock.mockRejectedValue(new Error("upstream ETIMEDOUT after 15000ms"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("KEY_NETWORK_TIMEOUT");
    spy.mockRestore();
  });

  it("UNKNOWN → 500 for unclassified server fault", async () => {
    // An error that matches none of the classifiers is a server fault.
    // 500 is correct — not the client's bad data, not a known upstream issue.
    validateKeyMock.mockRejectedValue(new Error("unexpected internal error XYZ"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("UNKNOWN");
    spy.mockRestore();
  });

  it("response body contains only 'code' — no raw 'error' field (H-0305 + H-0310 combined)", async () => {
    // Both H-0305 (no raw message) and H-0310 (correct status) must hold
    // simultaneously. Every classified error response must be { code } only.
    validateKeyMock.mockRejectedValue(new Error("ETIMEDOUT internal-detail-leaked-secret"));
    const spy = consoleErrSpy();

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    const json = await res.json();
    // Exactly one key in the body.
    expect(Object.keys(json)).toEqual(["code"]);
    expect(json.code).toBeDefined();
    spy.mockRestore();
  });
});
