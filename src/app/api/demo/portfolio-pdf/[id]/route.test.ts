import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { ACTIVE_PORTFOLIO_ID } from "@/lib/demo";

/**
 * Route handler tests for /api/demo/portfolio-pdf/[id] (H-0260).
 *
 * The public demo PDF endpoint ties demo-pdf-token verification + the
 * portfolio allowlist to an HTTP download. demo-pdf-token.ts has thorough
 * unit coverage, but the HTTP endpoint that wires the token to a portfolio_id
 * AND to the allowlist was unverified. A refactor that dropped the id-match
 * check would silently let a valid-but-mismatched token download ANY
 * portfolio's PDF.
 *
 * The route's auth ladder (route.ts:39-57):
 *   1. IP rate limit (publicIpLimiter)        → 429
 *   2. allowlist check on `id` (isDemoPortfolioId) → 404 if not allowlisted
 *   3. HMAC token verify (verifyDemoPdfToken)  → 401 if missing / mismatched
 *   4. happy path → Puppeteer renders + 200 application/pdf
 *
 * Cases:
 *   (1) 401 when token missing.
 *   (2) 401 when token signed for a DIFFERENT portfolio id (verify=false).
 *   (3) 404 when id not in the allowlist (even with a "valid" token).
 *   (4) 200 + PDF blob when allowlist + token both pass.
 *
 * `import "server-only"` throws under jsdom; stub it. Puppeteer + ratelimit +
 * the supabase admin client + the token verifier are all mocked so the test
 * exercises the route's branching, not the real subsystems.
 */

vi.mock("server-only", () => ({}));

// Rate limiter: always allow (we are not testing the 429 path here).
vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
  getClientIp: () => "1.2.3.4",
}));

// pdf-render-token / sanitize-filename are incidental to the auth ladder.
vi.mock("@/lib/pdf-render-token", () => ({
  signPdfRenderToken: () => "render-token",
}));
vi.mock("@/lib/sanitize-filename", () => ({
  sanitizeFilename: (raw: string, fallback: string) => raw || fallback,
}));

// Puppeteer — a fake browser/page so the happy path produces a PDF buffer
// without launching Chromium.
const pdfBytes = Buffer.from("%PDF-1.4 fake");
const closeSpy = vi.fn(async () => undefined);
const releaseSpy = vi.fn();
vi.mock("@/lib/puppeteer", () => ({
  PDF_QUEUE_TIMEOUT_MESSAGE: "PDF concurrency queue timeout",
  acquirePdfSlot: vi.fn(async () => releaseSpy),
  launchBrowser: vi.fn(async () => ({
    newPage: async () => ({
      setDefaultNavigationTimeout: () => {},
      setDefaultTimeout: () => {},
      setViewport: async () => {},
      goto: async () => {},
      pdf: async () => pdfBytes,
    }),
    close: closeSpy,
  })),
}));

// The token verifier — overridden per test via the spy below.
const verifySpy = vi.fn<(id: string, token: string | null | undefined) => boolean>();
vi.mock("@/lib/demo-pdf-token", () => ({
  verifyDemoPdfToken: (id: string, token: string | null | undefined) =>
    verifySpy(id, token),
}));

// Supabase admin: returns the allowlisted portfolio row.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { id: ACTIVE_PORTFOLIO_ID, name: "Active Persona" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const ALLOWLISTED = ACTIVE_PORTFOLIO_ID;
const NOT_ALLOWLISTED = "00000000-0000-4000-8000-999999999999";

function makeReq(url: string): NextRequest {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/demo/portfolio-pdf/[id] (H-0260)", () => {
  beforeEach(() => {
    verifySpy.mockReset();
    closeSpy.mockClear();
    releaseSpy.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(1) returns 401 when the token query param is missing", async () => {
    // verifyDemoPdfToken(id, null) → false. The route must reject before
    // touching Puppeteer.
    verifySpy.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(`http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}`),
      makeParams(ALLOWLISTED),
    );
    expect(res.status).toBe(401);
    // The verifier was consulted with the null token (no ?token=).
    expect(verifySpy).toHaveBeenCalledWith(ALLOWLISTED, null);
  });

  it("(2) returns 401 when the token was signed for a DIFFERENT portfolio id", async () => {
    // The id is allowlisted, a token IS present, but it was minted for
    // another portfolio so verifyDemoPdfToken returns false. Dropping the
    // id-match would let this download the allowlisted portfolio's PDF.
    verifySpy.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=token-for-other-pf`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(res.status).toBe(401);
    expect(verifySpy).toHaveBeenCalledWith(ALLOWLISTED, "token-for-other-pf");
    // No PDF should have been rendered.
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("(3) returns 404 when the id is not in the demo allowlist (even with a valid token)", async () => {
    // verifyDemoPdfToken would return true, but the allowlist gate (checked
    // FIRST) short-circuits to 404 before the token is even consulted.
    verifySpy.mockReturnValue(true);
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${NOT_ALLOWLISTED}?token=anything`,
      ),
      makeParams(NOT_ALLOWLISTED),
    );
    expect(res.status).toBe(404);
    // Allowlist precedes the token check — verify is never called.
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it("(4) returns 200 + a PDF blob when the allowlist AND token both pass", async () => {
    verifySpy.mockReturnValue(true);
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=valid-token`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    // No-store so an expired token can't be replayed from an edge cache.
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBe(pdfBytes.length);
    // The token was verified against the SAME id being downloaded.
    expect(verifySpy).toHaveBeenCalledWith(ALLOWLISTED, "valid-token");
    // The Puppeteer slot was acquired and released (no leak).
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
