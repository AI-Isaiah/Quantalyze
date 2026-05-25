import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * H-0281 — real route coverage for POST /api/keys/validate-and-encrypt.
 *
 * The previous contents of this file were TAUTOLOGICAL: every test asserted
 * on hardcoded local arrays/strings (PUBLIC_ROUTES, inline proxy logic) and
 * never imported the route handler. A refactor that broke the route could
 * not fail those tests because they had no dependency on `./route`.
 *
 * This rewrite drives the actual handler and pins its hot paths:
 *   (1) 429 + Retry-After when checkLimit fails
 *   (2) 400 when exchange / api_key / api_secret missing
 *   (3) 400 with the trading-permissions copy when validation.read_only=false
 *   (4) 400 with the propagated error.message when validateKey throws
 *   (5) happy path: {valid:true, read_only:true, ...encryptKey payload}
 *
 * Mocking mirrors keys/sync/route.test.ts: the route is wrapped by the REAL
 * withAuth, so `@/lib/supabase/server` is stubbed to return an authenticated
 * user (the approval gate is globally no-op'd in src/test-setup.ts).
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const {
  TEST_USER,
  mockValidateKey,
  mockEncryptKey,
  rateLimitResult,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockValidateKey: vi.fn(),
  mockEncryptKey: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
}));

// audit + supabase server modules import "server-only" which throws under
// vitest+jsdom.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => rateLimitResult,
}));

vi.mock("@/lib/analytics-client", () => ({
  validateKey: mockValidateKey,
  encryptKey: mockEncryptKey,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/keys/validate-and-encrypt", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-api-key",
  api_secret: "okx-api-secret",
  passphrase: "pp",
};

describe("POST /api/keys/validate-and-encrypt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      kek_version: 3,
    });
  });

  // ── (1) Rate limit → 429 + Retry-After ──────────────────────────────
  it("returns 429 with Retry-After when checkLimit fails", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 17;

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    // Short-circuited before touching the validation/encryption pipeline.
    expect(mockValidateKey).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (2) Missing required fields → 400 ───────────────────────────────
  it("returns 400 when exchange is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key: "k12345678", api_secret: "s12345678" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing required fields");
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("returns 400 when api_key is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "okx", api_secret: "s12345678" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  it("returns 400 when api_secret is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "okx", api_key: "k12345678" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  // ── (3) Non-read-only key → 400 with trading-permissions copy ──────
  it("returns 400 with the trading-permissions copy when validation.read_only is false", async () => {
    mockValidateKey.mockResolvedValue({ valid: true, read_only: false });

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "This key has trading or withdrawal permissions. Only read-only keys are accepted.",
    );
    // A non-read-only key must NEVER be encrypted to disk.
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (4) validateKey throws → 400, message propagated ───────────────
  it("returns 400 with the propagated error.message when validateKey throws", async () => {
    mockValidateKey.mockRejectedValue(new Error("Invalid API signature"));

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid API signature");
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (5) Happy path → 200 with encryptKey payload + valid/read_only ──
  it("returns the encryptKey payload spread with valid:true, read_only:true on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      kek_version: 3,
      valid: true,
      read_only: true,
    });

    // validate-then-encrypt ordering: validation runs before encryption
    // (TOCTOU-safe back-to-back) and both received the same credentials.
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp");
    expect(mockEncryptKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp");
  });
});
