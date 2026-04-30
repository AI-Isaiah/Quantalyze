/**
 * Regression test for the wizard ConnectKeyStep 502 bug.
 *
 * The Python analytics-service `/api/encrypt-key` endpoint stores all
 * credentials inside a single `api_key_encrypted` blob (envelope encryption,
 * see analytics-service/services/encryption.py:80-82) and intentionally
 * returns `api_secret_encrypted: null`. Migration 031 makes the matching
 * DB column nullable to accept this.
 *
 * The route's previous shape check `if (!api_key_encrypted ||
 * !api_secret_encrypted)` treated the intentional null as "missing" and
 * 502'd every wizard submission. This test pins the corrected check —
 * envelope-shaped responses must round-trip to a 200 with strategy_id +
 * api_key_id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const MOCK_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as unknown as
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

// Pull POST after mocks so module-init reads the mocked deps.
async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const WIZARD_SESSION_ID = "11111111-2222-4333-8444-555555555555";
const STRATEGY_ID = "ssssssss-ssss-4sss-8sss-ssssssssssss";
const API_KEY_ID = "kkkkkkkk-kkkk-4kkk-8kkk-kkkkkkkkkkkk";

const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-key-with-enough-chars",
  api_secret: "okx-secret-with-enough-chars",
  passphrase: "okx-passphrase",
  label: "regression test key",
  wizard_session_id: WIZARD_SESSION_ID,
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/strategies/create-with-key", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/strategies/create-with-key — envelope-encryption shape", () => {
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

  it("accepts api_secret_encrypted=null (envelope-encryption contract) and returns 200", async () => {
    // The Python service intentionally returns api_secret_encrypted: null
    // because all credentials are bundled inside api_key_encrypted.
    encryptKeyMock.mockResolvedValue({
      api_key_encrypted: "encrypted-blob-base64",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: null,
      nonce: null,
      kek_version: 1,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      strategy_id: STRATEGY_ID,
      api_key_id: API_KEY_ID,
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("create_wizard_strategy");
    expect((rpcArgs as Record<string, unknown>).p_api_key_encrypted).toBe(
      "encrypted-blob-base64",
    );
    expect((rpcArgs as Record<string, unknown>).p_api_secret_encrypted).toBeNull();
  });

  it("still 502s when api_key_encrypted itself is missing", async () => {
    encryptKeyMock.mockResolvedValue({
      api_key_encrypted: undefined,
      api_secret_encrypted: null,
      kek_version: 1,
    });

    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.code).toBe("UNKNOWN");
    expect(json.error).toBe(
      "Encryption service returned an unexpected response",
    );
  });
});
