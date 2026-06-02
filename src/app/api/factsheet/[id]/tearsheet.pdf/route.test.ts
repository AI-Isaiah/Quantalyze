/**
 * audit-2026-05-07 C-0092 + C-0093 — receiver-side coverage for the
 * tearsheet PDF route's SSRF allowlist, UUID validation, and Cache-Control
 * + Vary header contract.
 *
 * Mirrors the structure of the sibling pdf/route.test.ts so the two stay
 * audit-parallel.
 */
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: {},
  checkLimit: vi.fn(),
  getClientIp: vi.fn().mockReturnValue("127.0.0.1"),
  // F5b (L-0018): route now JSON-normalizes rate-limit denials via
  // rateLimitDenyJson (was inline plain-text) — mirror the real helper.
  rateLimitDenyJson: (rl: { retryAfter: number; reason?: string }) =>
    NextResponse.json(
      {
        error:
          rl.reason === "ratelimit_misconfigured"
            ? "Rate limiter unavailable"
            : "Too many requests",
      },
      {
        status: rl.reason === "ratelimit_misconfigured" ? 503 : 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    ),
}));
import { checkLimit } from "@/lib/ratelimit";

vi.mock("@/lib/puppeteer", () => ({
  launchBrowser: vi.fn(),
  acquirePdfSlot: vi.fn(),
  PDF_QUEUE_TIMEOUT_MESSAGE: "queue full",
}));

const ENV_BACKUP = { ...process.env };
const STRATEGY_ID = "00000000-0000-0000-0000-000000000001";

function mkParams(id: string = STRATEGY_ID): {
  params: Promise<{ id: string }>;
} {
  return { params: Promise.resolve({ id }) };
}

function singlePublishedComplete() {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: STRATEGY_ID,
      name: "Momentum Strategy",
      status: "published",
      strategy_analytics: [{ computation_status: "complete" }],
    },
    error: null,
  });
  const eq2 = vi.fn().mockReturnValue({ single });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
}

describe("GET /api/factsheet/[id]/tearsheet.pdf — B3 analytics gating (Phase 19.1)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({
      success: true,
      retryAfter: 0,
    } as never);
    vi.mocked(createAdminClient).mockReset();
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("computation_status 'complete_with_warnings' is NOT rejected by the analytics gate", async () => {
    // Parity with the sibling pdf route + the /strategy/[id] page gate: a CSV
    // strategy with an unavailable benchmark computes valid metrics under
    // `complete_with_warnings`. Pre-B3 the gate admitted only `complete`, so
    // the tearsheet PDF 400'd while the HTML factsheet rendered. The route must
    // pass the gate and reach the PDF queue slot (which sits after the gate).
    const single = vi.fn().mockResolvedValue({
      data: {
        id: STRATEGY_ID,
        name: "CSV Strategy (benchmark unavailable)",
        status: "published",
        strategy_analytics: [
          { computation_status: "complete_with_warnings" },
        ],
      },
      error: null,
    });
    const eq2 = vi.fn().mockReturnValue({ single });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    const from = vi.fn().mockReturnValue({ select });
    vi.mocked(createAdminClient).mockReturnValue({ from } as never);

    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.example.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    try {
      await GET(req, mkParams());
    } catch (err) {
      // The puppeteer chain is mocked incompletely here, so the route throws
      // AFTER the analytics gate. This test asserts only that the gate was
      // passed — acquirePdfSlot is invoked immediately after it.
      void err;
    }
    // The analytics gate (400 "Analytics not computed") returns BEFORE
    // acquirePdfSlot. acquirePdfSlot being called proves complete_with_warnings
    // passed the gate — regresses loud if the gate is narrowed back.
    const puppeteer = await import("@/lib/puppeteer");
    expect(puppeteer.acquirePdfSlot).toHaveBeenCalled();
  });
});

describe("GET /api/factsheet/[id]/tearsheet.pdf — SSRF + UUID validation (C-0092)", () => {
  let goto: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({
      success: true,
      retryAfter: 0,
    } as never);
    vi.mocked(createAdminClient).mockReset();
    singlePublishedComplete();

    const puppeteer = await import("@/lib/puppeteer");
    vi.mocked(puppeteer.acquirePdfSlot).mockReset();
    vi.mocked(puppeteer.launchBrowser).mockReset();
    vi.mocked(puppeteer.acquirePdfSlot).mockResolvedValue(() => {});
    goto = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      goto,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setViewport: vi.fn().mockResolvedValue(undefined),
      pdf: vi
        .fn()
        .mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(puppeteer.launchBrowser).mockResolvedValue({
      newPage,
      close,
    } as never);
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("C-0092: non-UUID id returns 400 without launching puppeteer or hitting Supabase", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.com/api/factsheet/not-a-uuid/tearsheet.pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams("not-a-uuid"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid strategy id");
    // Critical anti-assertions: the un-validated id was the SSRF primitive,
    // so the rejection MUST happen before any puppeteer / Supabase work.
    expect(goto).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("C-0092: SSRF attempt via path-traversal in id returns 400", async () => {
    // Pre-fix, `${APP_URL}/factsheet/${id}/tearsheet` with id like
    // `../../api/admin/users` would have driven puppeteer to traverse
    // off the intended path. UUID validation closes this.
    const { GET } = await import("./route");
    const attackerId = "../../api/admin/users";
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${encodeURIComponent(attackerId)}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams(attackerId));
    expect(res.status).toBe(400);
    expect(goto).not.toHaveBeenCalled();
  });

  it("C-0092: production VERCEL_ENV rejects spoofed Host outside the allowlist (500, no puppeteer)", async () => {
    // Pre-fix, the route blindly trusted `APP_URL` from a module-level
    // env read. An attacker-influenced Host (preview deploy with leaked
    // env, custom proxy, `curl --resolve`) could navigate puppeteer to
    // an arbitrary origin. The per-request allowlist closes this.
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://evil.example.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(500);
    expect(goto).not.toHaveBeenCalled();
  });

  it("C-0092: production VERCEL_ENV accepts the production host (positive control)", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze-rho.vercel.app/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto.mock.calls[0][0]).toBe(
      `https://quantalyze-rho.vercel.app/factsheet/${STRATEGY_ID}/tearsheet`,
    );
  });

  it("C-0092: production VERCEL_ENV accepts VERCEL_URL for preview-branch deploys", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "quantalyze-abc123-team.vercel.app";
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze-abc123-team.vercel.app/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto.mock.calls[0][0]).toBe(
      `https://quantalyze-abc123-team.vercel.app/factsheet/${STRATEGY_ID}/tearsheet`,
    );
  });

  it("C-0092: non-production env uses request origin (no allowlist needed for dev/preview)", async () => {
    // VERCEL_ENV unset (i.e. local dev / unit test) — request origin is
    // honored as-is so `next dev` and tests still work.
    delete process.env.VERCEL_ENV;
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.example.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto.mock.calls[0][0]).toBe(
      `https://quantalyze.example.com/factsheet/${STRATEGY_ID}/tearsheet`,
    );
  });

  it("C-0092: NEXT_PUBLIC_APP_URL misconfiguration cannot redirect puppeteer when origin is present", async () => {
    // Defense-in-depth: even if NEXT_PUBLIC_APP_URL is poisoned, the
    // per-request resolver prefers req.nextUrl.origin so the inner
    // render hits the SAME deployment serving this request.
    process.env.NEXT_PUBLIC_APP_URL = "https://attacker.example.com";
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://correct-host.example.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto.mock.calls[0][0]).toBe(
      `https://correct-host.example.com/factsheet/${STRATEGY_ID}/tearsheet`,
    );
    expect(goto.mock.calls[0][0]).not.toContain("attacker.example.com");
  });
});

describe("GET /api/factsheet/[id]/tearsheet.pdf — Cache-Control + Vary (C-0093)", () => {
  let goto: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({
      success: true,
      retryAfter: 0,
    } as never);
    vi.mocked(createAdminClient).mockReset();
    singlePublishedComplete();

    const puppeteer = await import("@/lib/puppeteer");
    vi.mocked(puppeteer.acquirePdfSlot).mockReset();
    vi.mocked(puppeteer.launchBrowser).mockReset();
    vi.mocked(puppeteer.acquirePdfSlot).mockResolvedValue(() => {});
    goto = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      goto,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setViewport: vi.fn().mockResolvedValue(undefined),
      pdf: vi
        .fn()
        .mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(puppeteer.launchBrowser).mockResolvedValue({
      newPage,
      close,
    } as never);
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("C-0093: Cache-Control max-age is tightened (<= 300s) so disclosure-tier downgrades flush quickly", async () => {
    // Pre-fix: `s-maxage=3600, stale-while-revalidate=86400` pinned
    // stale PDFs in the CDN for up to 25h after a disclosure_tier
    // downgrade. The tightened window bounds the worst-case staleness
    // to a few minutes.
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control");
    expect(cc).not.toBeNull();
    // s-maxage MUST be <= 300 (5 minutes). Anti-assertion against the
    // pre-fix 3600s window.
    const sMaxAge = cc!.match(/s-maxage=(\d+)/);
    expect(sMaxAge).not.toBeNull();
    expect(Number(sMaxAge![1])).toBeLessThanOrEqual(300);
    // Explicit regression guard against the pre-fix directive byte-for-byte.
    expect(cc).not.toBe("s-maxage=3600, stale-while-revalidate=86400");
  });

  it("C-0093: Vary header lists Cookie and Authorization so the CDN keys on auth state", async () => {
    // Pre-fix: NO Vary header. If the route's statelessness ever
    // regresses (cookies forwarded to puppeteer), an authenticated
    // institutional render could pin in the CDN and be served to a
    // future anonymous request. Declaring Vary on auth-bearing headers
    // is the structural defense.
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const vary = res.headers.get("Vary");
    expect(vary).not.toBeNull();
    // Tokenize the Vary header (RFC 7231: comma-separated, case-insensitive).
    const tokens = vary!
      .split(",")
      .map((t) => t.trim().toLowerCase());
    expect(tokens).toContain("cookie");
    expect(tokens).toContain("authorization");
  });

  it("C-0093: Vary also includes Host so the CDN cannot bleed across deployment aliases", async () => {
    // Mirrors the HIGH#2 fix on the sibling pdf/route.ts: PDF bytes are
    // a function of the Host header at generation time (via the
    // puppeteer goto), so the shared CDN MUST key per-host or it will
    // serve a preview-aliased PDF to a production-aliased request.
    const { GET } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${STRATEGY_ID}/tearsheet.pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const vary = res.headers.get("Vary");
    const tokens = vary!
      .split(",")
      .map((t) => t.trim().toLowerCase());
    expect(tokens).toContain("host");
  });
});
