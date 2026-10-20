import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Route handler tests for /api/portfolio-pdf/[id].
 *
 * The render page throws when a read fails and Next serves its error screen
 * with HTTP 500. Puppeteer's `page.goto` resolves with that response instead of
 * rejecting, so the route must look at the status: otherwise `page.pdf()`
 * prints the error screen and the user receives it as a 200 PDF.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
  getClientIp: () => "1.2.3.4",
  rateLimitDenyJson: vi.fn(),
}));
vi.mock("@/lib/pdf-render-token", () => ({
  signPdfRenderToken: () => "render-token",
}));
vi.mock("@/lib/sanitize-filename", () => ({
  sanitizeFilename: (raw: string, fallback: string) => raw || fallback,
}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("@/lib/queries", () => ({
  assertPortfolioOwnership: vi.fn(async () => true),
  getPortfolioDetail: vi.fn(async () => ({ name: "Alpha" })),
}));

const pdfBytes = Buffer.from("%PDF-1.4 fake");
const closeSpy = vi.fn(async () => undefined);
const releaseSpy = vi.fn();
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

const ID = "00000000-0000-4000-8000-000000000001";

function makeReq(): NextRequest {
  return { headers: new Headers() } as unknown as NextRequest;
}

describe("GET /api/portfolio-pdf/[id]", () => {
  beforeEach(() => {
    closeSpy.mockClear();
    releaseSpy.mockClear();
    pdfSpy.mockClear();
    gotoSpy.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a PDF when the render page answers ok", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("returns the 500 error response, not a PDF, when the render page answers non-ok", async () => {
    gotoSpy.mockResolvedValueOnce({ ok: () => false, status: () => 500 });
    const { GET } = await import("./route");
    const res = await GET(makeReq(), { params: Promise.resolve({ id: ID }) });
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).not.toBe("application/pdf");
    expect(pdfSpy).not.toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
