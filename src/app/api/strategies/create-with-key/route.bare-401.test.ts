/**
 * 212-04 / SC3 — a BARE upstream 401 on `create-with-key` answers
 * SEAM_MISCONFIGURED, never the terminal UNKNOWN.
 *
 * Production, 2026-08-25: our own analytics service key was stale, the service
 * answered a bare 401 with no seam envelope, and `AnalyticsUpstreamError.seamCode`
 * was null. `validate-and-encrypt` alone read the status
 * (`UPSTREAM_STATUS_TO_SEAM_CODE`); this route's classifier fell through its
 * message cascade to UNKNOWN. The credential on that hop is OUR service key (the
 * user's exchange key is the request body), so the right answer names our own
 * configuration, status 500, and nothing is encrypted or written.
 *
 * Kept in its own file because `route.test.ts` belongs to plan 212-03 in the
 * same wave; the mock scaffold is copied from `route.audit.test.ts`.
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
// The module is mocked wholesale, so `AnalyticsUpstreamError` is undefined here
// and the classifier must read `status` / `seamCode` as own properties.
vi.mock("@/lib/analytics-client", () => ({
  validateKey: (...args: unknown[]) => validateKeyMock(...args),
  encryptKey: (...args: unknown[]) => encryptKeyMock(...args),
}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

async function importPost() {
  const mod = await import("./route");
  return mod.POST;
}

const VALID_BODY = {
  exchange: "binance",
  api_key: "binance-key-with-enough-chars",
  api_secret: "binance-secret-with-enough-chars",
  label: "bare 401 key",
  wizard_session_id: "22222222-3333-4444-8555-666666666666",
};

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/strategies/create-with-key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("[212-04 / SC3] create-with-key — a bare upstream 401", () => {
  beforeEach(() => {
    validateKeyMock.mockReset();
    encryptKeyMock.mockReset();
    rpcMock.mockReset();
  });

  it("answers SEAM_MISCONFIGURED at 500, not UNKNOWN, and writes nothing", async () => {
    validateKeyMock.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), {
        name: "AnalyticsUpstreamError",
        status: 401,
        seamCode: null,
      }),
    );

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    const POST = await importPost();
    const res = await POST(makeReq(VALID_BODY));
    const json = await res.json();
    consoleErr.mockRestore();

    expect(res.status).toBe(500);
    expect(json.code).toBe("SEAM_MISCONFIGURED");
    expect(encryptKeyMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
