/**
 * Phase 18 / Plan 03 / Adversarial revision B4 — receiver-side coverage for the
 * `x-internal-token` rate-limit bypass on the factsheet PDF endpoint.
 *
 * The cron caller side (`src/app/api/cron/founder-lp-report/route.test.ts`)
 * verifies the cron sets the header. This test covers the OTHER half of that
 * contract: the factsheet endpoint must honor the token. Without these tests
 * the bypass could silently break and the cron would still appear to work
 * (its mock fetch returns 200 regardless), but in production the cron would
 * collide with `publicIpLimiter` on the shared Vercel egress IP.
 *
 * Coverage:
 *   1. Internal call with matching token + token-env set → bypasses limiter
 *      (rate-limit `checkLimit` is NOT called).
 *   2. Internal call with WRONG token → falls through to `checkLimit`
 *      (constant-time compare rejects mismatch).
 *   3. NO `x-internal-token` header → falls through to `checkLimit`.
 *   4. INTERNAL_API_TOKEN env empty/unset → header is ignored, falls through
 *      (the `internalEnv.length > 0` gate — prevents config drift where an
 *      empty env var creates a permanent backdoor).
 *
 * Note: we don't drive the full puppeteer/PDF generation path. Each test
 * stubs `createAdminClient` to return `{error: not-found}`, which short-
 * circuits at the strategy lookup with a 404. The 404 is the signal that
 * the rate-limit gate was passed (or bypassed). Whether `checkLimit` was
 * called is the actual assertion.
 */
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

// Supabase admin — stubbed to a no-data not-found path. Same shape that
// the route's `.from("strategies").select(...).eq(...).eq(...).single()`
// expects, but resolves to `{data: null, error: {message: "no row"}}`.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";

// Rate limiter — `checkLimit` is the assertion target. We want to know
// whether the route invoked it (NOT bypassed) or skipped it (bypassed).
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: { /* opaque */ },
  checkLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));
import { checkLimit } from "@/lib/ratelimit";

// Puppeteer — defensive stubs so the route never tries to launch Chromium.
// The not-found Supabase chain returns 404 BEFORE we'd ever hit acquirePdfSlot,
// but mocking these defends against test-shape changes.
vi.mock("@/lib/puppeteer", () => ({
  launchBrowser: vi.fn(),
  acquirePdfSlot: vi.fn(),
  PDF_QUEUE_TIMEOUT_MESSAGE: "queue full",
}));

const ENV_BACKUP = { ...process.env };

function singleNotFound() {
  const single = vi.fn().mockResolvedValue({
    data: null,
    error: { message: "no row" },
  });
  const eq2 = vi.fn().mockReturnValue({ single });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
}

function buildReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
    { method: "GET", headers },
  );
}

describe("GET /api/factsheet/[id]/pdf — x-internal-token bypass (Phase 18 / Plan 03 / B4)", () => {
  beforeEach(() => {
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({ success: true, retryAfter: 0 } as never);
    vi.mocked(createAdminClient).mockReset();
    singleNotFound();

    process.env.INTERNAL_API_TOKEN = "valid-internal-token-abc";
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("matching x-internal-token bypasses publicIpLimiter (checkLimit NOT called)", async () => {
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      { params },
    );
    // We hit the strategy lookup → 404 (since the stub returns no-row).
    expect(res.status).toBe(404);
    // The bypass is the contract under test: limiter must NOT have been
    // consulted because the internal token matched.
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it("wrong x-internal-token falls through to publicIpLimiter (checkLimit IS called)", async () => {
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "wrong-token-zzz" }),
      { params },
    );
    expect(res.status).toBe(404);
    // safeCompare on mismatch → fall through to limiter.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("no x-internal-token header falls through to publicIpLimiter", async () => {
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(buildReq(), { params });
    expect(res.status).toBe(404);
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("INTERNAL_API_TOKEN env empty rejects bypass even when header present (config-drift guard)", async () => {
    process.env.INTERNAL_API_TOKEN = "";
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      { params },
    );
    expect(res.status).toBe(404);
    // internalEnv.length > 0 gate must reject: empty env var must NOT
    // create a permanent bypass for any non-empty header value.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("INTERNAL_API_TOKEN unset (env deleted) rejects bypass even when header present (T4 — distinct from empty-string)", async () => {
    delete process.env.INTERNAL_API_TOKEN;
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      { params },
    );
    expect(res.status).toBe(404);
    // typeof internalEnv === 'string' gate must reject undefined env entirely.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("R1: VERCEL_ENV='preview' forces fall-through to publicIpLimiter even with valid token", async () => {
    process.env.VERCEL_ENV = "preview";
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      { params },
    );
    expect(res.status).toBe(404);
    // Preview deploys must NEVER honor the bypass — the IP limiter is
    // consulted regardless of token validity.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("R1: VERCEL_ENV='production' + valid token bypasses publicIpLimiter (positive control)", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      { params },
    );
    expect(res.status).toBe(404);
    // Production + valid token = bypass engages.
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it("rate limiter 429 short-circuits with Retry-After (no Supabase touch on public path)", async () => {
    vi.mocked(checkLimit).mockResolvedValueOnce({
      success: false,
      retryAfter: 42,
    } as never);
    const { GET } = await import("./route");
    const params = Promise.resolve({ id: "00000000-0000-0000-0000-000000000001" });
    const res = await GET(buildReq(), { params });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    // Limiter consulted; no Supabase call should have occurred.
    expect(checkLimit).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
