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

const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureSpy }));

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
// What `page.goto` resolves with. Puppeteer resolves a navigation with the main
// response, and a non-2xx one is NOT a rejection, so the route has to look.
const gotoSpy = vi.fn(async (): Promise<unknown> => ({ ok: () => true, status: () => 200 }));
const pdfSpy = vi.fn(async () => pdfBytes);
vi.mock("@/lib/puppeteer", () => ({
  PDF_QUEUE_TIMEOUT_MESSAGE: "PDF concurrency queue timeout",
  acquirePdfSlot: vi.fn(async () => releaseSpy),
  launchBrowser: vi.fn(async () => ({
    newPage: async () => ({
      setDefaultNavigationTimeout: () => {},
      setDefaultTimeout: () => {},
      setViewport: async () => {},
      goto: gotoSpy,
      pdf: pdfSpy,
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
    pdfSpy.mockClear();
    gotoSpy.mockClear();
    captureSpy.mockClear();
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

  it("(5) returns the 500 error response, not a PDF, when the render page answers non-ok", async () => {
    // The render page throws on a failed read and Next serves its error screen
    // with HTTP 500. Puppeteer's `goto` resolves with that response rather than
    // rejecting, so without a status check `page.pdf()` prints the error
    // screen and the user receives it as a 200 PDF.
    verifySpy.mockReturnValue(true);
    gotoSpy.mockResolvedValueOnce({ ok: () => false, status: () => 500 });
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=valid-token`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).not.toBe("application/pdf");
    expect(pdfSpy).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("(6) captures a non-ok render with the status, the portfolio id and its own step tag", async () => {
    verifySpy.mockReturnValue(true);
    gotoSpy.mockResolvedValueOnce({ ok: () => false, status: () => 404 });
    const { GET } = await import("./route");
    await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=valid-token`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(captureSpy).toHaveBeenCalledTimes(1);
    const [err, ctx] = captureSpy.mock.calls[0];
    expect((err as Error).message).toContain("404");
    expect((err as Error).message).toContain(ALLOWLISTED);
    expect(ctx.tags).toEqual({ area: "demo-portfolio-pdf", step: "render_status" });
  });

  it("(7) captures a crash under the pdf_generation tag", async () => {
    verifySpy.mockReturnValue(true);
    gotoSpy.mockRejectedValueOnce(new Error("Target closed"));
    const { GET } = await import("./route");
    await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=valid-token`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(captureSpy.mock.calls[0][1].tags).toEqual({
      area: "demo-portfolio-pdf",
      step: "pdf_generation",
    });
  });

  it("(8) the 500 body is a sentence the user can act on, not a JSON envelope", async () => {
    verifySpy.mockReturnValue(true);
    gotoSpy.mockResolvedValueOnce({ ok: () => false, status: () => 500 });
    const { GET } = await import("./route");
    const res = await GET(
      makeReq(
        `http://localhost/api/demo/portfolio-pdf/${ALLOWLISTED}?token=valid-token`,
      ),
      makeParams(ALLOWLISTED),
    );
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(
      "We couldn't generate this PDF. Close this tab and try again.",
    );
  });
});
