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
  isRateLimitMisconfigured: (rl: { success: boolean; reason?: string }) =>
    rl.success === false && rl.reason === "ratelimit_misconfigured",
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

// Phase-5 simplify (2026-05-17) — hoisted constant + params helper for the
// canonical test strategy UUID. Pre-Phase-5 the literal appeared 44× inline;
// this constant covers the `mkParams()` + `buildReq()` callsites. URL
// strings inside `NextRequest(...)` constructors and fixture/assertion
// payloads were deliberately left inline as documentation per the
// Phase-5 simplify charter (CHANGELOG 0.22.40.34). Kept verbose-named so
// test failures surface the constant unambiguously.
const STRATEGY_ID = "00000000-0000-0000-0000-000000000001";

function mkParams(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: STRATEGY_ID }) };
}

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
    `http://localhost:3000/api/factsheet/${STRATEGY_ID}/pdf`,
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
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      mkParams(),
    );
    // We hit the strategy lookup → 404 (since the stub returns no-row).
    expect(res.status).toBe(404);
    // The bypass is the contract under test: limiter must NOT have been
    // consulted because the internal token matched.
    expect(checkLimit).not.toHaveBeenCalled();
  });

  it("wrong x-internal-token falls through to publicIpLimiter (checkLimit IS called)", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      buildReq({ "x-internal-token": "wrong-token-zzz" }),
      mkParams(),
    );
    expect(res.status).toBe(404);
    // safeCompare on mismatch → fall through to limiter.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("no x-internal-token header falls through to publicIpLimiter", async () => {
    const { GET } = await import("./route");
    const res = await GET(buildReq(), mkParams());
    expect(res.status).toBe(404);
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("INTERNAL_API_TOKEN env empty rejects bypass even when header present (config-drift guard)", async () => {
    process.env.INTERNAL_API_TOKEN = "";
    const { GET } = await import("./route");
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      mkParams(),
    );
    expect(res.status).toBe(404);
    // internalEnv.length > 0 gate must reject: empty env var must NOT
    // create a permanent bypass for any non-empty header value.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("INTERNAL_API_TOKEN unset (env deleted) rejects bypass even when header present (T4 — distinct from empty-string)", async () => {
    delete process.env.INTERNAL_API_TOKEN;
    const { GET } = await import("./route");
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      mkParams(),
    );
    expect(res.status).toBe(404);
    // typeof internalEnv === 'string' gate must reject undefined env entirely.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("R1: VERCEL_ENV='preview' forces fall-through to publicIpLimiter even with valid token", async () => {
    process.env.VERCEL_ENV = "preview";
    const { GET } = await import("./route");
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      mkParams(),
    );
    expect(res.status).toBe(404);
    // Preview deploys must NEVER honor the bypass — the IP limiter is
    // consulted regardless of token validity.
    expect(checkLimit).toHaveBeenCalledTimes(1);
  });

  it("R1: VERCEL_ENV='production' + valid token bypasses publicIpLimiter (positive control)", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const res = await GET(
      buildReq({ "x-internal-token": "valid-internal-token-abc" }),
      mkParams(),
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
    const res = await GET(buildReq(), mkParams());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    // Limiter consulted; no Supabase call should have occurred.
    expect(checkLimit).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

/**
 * Cluster L / Fix C-0086 + M-0311 — receiver-side coverage for the URL-origin
 * preference (no more silent localhost fallback in production) and the
 * Cache-Control directive (must be public/CDN-cacheable because the route is
 * in PUBLIC_ROUTES, not auth-gated). These tests drive the success path
 * through puppeteer mocks and assert on `page.goto` and response headers.
 */
function singlePublishedComplete(
  overrides: { computed_at?: string } = {},
) {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Momentum Strategy",
      status: "published",
      strategy_analytics: [
        {
          computation_status: "complete",
          // audit-2026-05-07 red-team HIGH#3 — ETag is bound to
          // analytics.computed_at; fixture must provide a deterministic
          // value so cache-revalidation assertions are stable.
          computed_at: overrides.computed_at ?? "2026-05-17T00:00:00.000Z",
        },
      ],
    },
    error: null,
  });
  const eq2 = vi.fn().mockReturnValue({ single });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
}

describe("GET /api/factsheet/[id]/pdf — URL origin + Cache-Control (Cluster L / C-0086, M-0311)", () => {
  // Describe-scoped goto spy — re-assigned per test in beforeEach. Replaces
  // the prior globalThis.__pdfGoto backchannel (specialist:maintainability
  // HIGH/7 — non-idiomatic vs vitest's standard describe-scoped pattern).
  let goto: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({ success: true, retryAfter: 0 } as never);
    vi.mocked(createAdminClient).mockReset();
    singlePublishedComplete();

    // Build a fresh puppeteer mock per test so we can spy on page.goto.
    const puppeteer = await import("@/lib/puppeteer");
    vi.mocked(puppeteer.acquirePdfSlot).mockResolvedValue(() => {});
    goto = vi.fn().mockResolvedValue(undefined);
    const setDefaultNavigationTimeout = vi.fn();
    const setDefaultTimeout = vi.fn();
    const setViewport = vi.fn().mockResolvedValue(undefined);
    const setUserAgent = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const pdf = vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const newPage = vi.fn().mockResolvedValue({
      goto,
      setDefaultNavigationTimeout,
      setDefaultTimeout,
      setViewport,
      setUserAgent,
      evaluate,
      pdf,
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(puppeteer.launchBrowser).mockResolvedValue({ newPage, close } as never);
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("Fix C-0086: puppeteer navigates to req.nextUrl.origin, NOT NEXT_PUBLIC_APP_URL or localhost", async () => {
    // Worst case the prior bug guarded against: env var unset, request
    // arrives on production origin. Old code would navigate to
    // http://localhost:3000 (15s timeout → 500). New code prefers origin.
    delete process.env.NEXT_PUBLIC_APP_URL;
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto.mock.calls[0][0]).toBe(
      "https://quantalyze.example.com/factsheet/00000000-0000-0000-0000-000000000001",
    );
    // Must NEVER be the silent localhost fallback in this scenario.
    expect(goto.mock.calls[0][0]).not.toContain("localhost");
  });

  it("Fix C-0086: origin preferred even when NEXT_PUBLIC_APP_URL is set to a different host", async () => {
    // Defense-in-depth: misconfigured env var must not redirect puppeteer
    // away from the current deployment (the trigger for C-0090 amplification).
    process.env.NEXT_PUBLIC_APP_URL = "https://wrong-host.example.com";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://correct-host.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto.mock.calls[0][0]).toBe(
      "https://correct-host.example.com/factsheet/00000000-0000-0000-0000-000000000001",
    );
    expect(goto.mock.calls[0][0]).not.toContain("wrong-host");
  });

  it("Fix M-0311: Cache-Control is public + s-maxage (matches PUBLIC_ROUTES contract), NOT private", async () => {
    // The route is in PUBLIC_ROUTES (src/proxy.ts) with no auth.getUser()
    // gate. The previous `private, max-age=86400` directive lied to caches
    // and blocked the shared CDN from absorbing duplicate hits. Must match
    // sibling tearsheet.pdf's public CDN cache policy.
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control");
    expect(cc).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    // Regression guard — explicit anti-assertion against the old directive.
    expect(cc).not.toContain("private");
    expect(cc).not.toMatch(/^max-age=/);
  });

  it("Specialist pr-test-analyzer (F5.1): Content-Disposition filename uses sanitizeFilename and embeds strategy name", async () => {
    // Closes a coverage gap: the inline path did not assert the
    // Content-Disposition header carried the sanitized filename. A future
    // regression that drops the sanitizer (e.g. moves to raw template
    // interpolation) would re-open header-injection risk via newline/quote
    // in strategy.name. The mock above sets strategy.name = "Momentum
    // Strategy" — the response header MUST reflect that, lowercased
    // through sanitizeFilename (which preserves alpha+space).
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition");
    expect(cd).toBe('inline; filename="Momentum Strategy-factsheet.pdf"');
    // Header-injection guard: no CR/LF allowed in the disposition value.
    expect(cd).not.toMatch(/[\r\n]/);
  });
});

/**
 * Cluster L specialist coverage (pr-test-analyzer F5.2) — analytics not
 * computed must short-circuit with 400 BEFORE any puppeteer / browser
 * launch. Previously uncovered.
 */
describe("GET /api/factsheet/[id]/pdf — analytics gating (Cluster L specialist F5.2)", () => {
  // Audit-2026-05-07 red-team MED#4 — describe-scoped puppeteer mocks. The
  // prior shape relied on the previous describe block (URL origin + Cache-
  // Control) having configured `acquirePdfSlot.mockResolvedValue(...)` in
  // its own beforeEach. Vitest does not guarantee describe order; if F5.2
  // ran first, puppeteer mocks were `vi.fn()` returning undefined, the
  // route would throw inside try/catch and return 500. The anti-assertion
  // `expect(launchBrowser).not.toHaveBeenCalled()` would still HOLD in
  // that pathological case, masking a real test-shape bug. We now
  // configure the puppeteer mocks explicitly in this describe's
  // beforeEach so the test is hermetic regardless of run order.
  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({ success: true, retryAfter: 0 } as never);
    vi.mocked(createAdminClient).mockReset();
    const puppeteer = await import("@/lib/puppeteer");
    vi.mocked(puppeteer.acquirePdfSlot).mockReset();
    vi.mocked(puppeteer.launchBrowser).mockReset();
    // Defensive default: if the route ever fell through to puppeteer
    // (which it must NOT in this describe block), launchBrowser would
    // resolve and the not-called anti-assertion would fail loud — surfacing
    // the gating regression instead of silently masking it.
    vi.mocked(puppeteer.acquirePdfSlot).mockResolvedValue(() => {});
    vi.mocked(puppeteer.launchBrowser).mockResolvedValue({
      newPage: vi.fn(),
      close: vi.fn(),
    } as never);
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("analytics computation_status !== 'complete' returns 400 without launching puppeteer", async () => {
    // Strategy exists + published, analytics row present but still
    // computing. The route must reject with 400 — and crucially, must
    // NOT have called acquirePdfSlot/launchBrowser. The latter is the
    // expensive side-effect we are guarding against; a previous
    // regression dropping the gate would silently leak Chromium launches.
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Pending Strategy",
        status: "published",
        strategy_analytics: [{ computation_status: "running" }],
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
      "https://quantalyze.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    // Audit-2026-05-07 red-team MED#4 — assert status + body PRECONDITION
    // before the anti-assertions. If the route fell through to puppeteer
    // and returned 500, the 400 check fails LOUD here rather than the
    // not-called assertions passing for the wrong reason later.
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Analytics not computed");
    // Critical side-effect anti-assertion: no Chromium boot.
    const puppeteer = await import("@/lib/puppeteer");
    expect(puppeteer.acquirePdfSlot).not.toHaveBeenCalled();
    expect(puppeteer.launchBrowser).not.toHaveBeenCalled();
  });

  it("B3 (Phase 19.1): computation_status 'complete_with_warnings' is NOT rejected by the gate (proceeds to render)", async () => {
    // A CSV strategy with an unavailable benchmark computes valid metrics and
    // lands at `complete_with_warnings`. Pre-B3 the gate only admitted
    // `complete`, so the HTML factsheet would render metrics while this PDF
    // export 400'd — the same narrow-gate symptom B3 fixes on the page. This
    // is the inverse of the test above: the route MUST pass the gate and reach
    // the PDF queue slot. `computed_at` is supplied so the ETag stage (which
    // runs before acquirePdfSlot) doesn't short-circuit.
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "CSV Strategy (benchmark unavailable)",
        status: "published",
        strategy_analytics: [
          {
            computation_status: "complete_with_warnings",
            computed_at: "2026-05-17T00:00:00.000Z",
          },
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
      "https://quantalyze.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    try {
      await GET(req, mkParams());
    } catch (err) {
      // The puppeteer chain is mocked incompletely in this describe, so the
      // route throws AFTER the analytics gate. This test asserts only that the
      // gate was passed — acquirePdfSlot is invoked immediately after it.
      void err;
    }
    // The analytics gate (400 "Analytics not computed") returns BEFORE
    // acquirePdfSlot. acquirePdfSlot being called therefore proves
    // complete_with_warnings passed the gate — regresses loud if the gate is
    // ever narrowed back to `complete` only.
    const puppeteer = await import("@/lib/puppeteer");
    expect(puppeteer.acquirePdfSlot).toHaveBeenCalled();
  });
});

/**
 * Audit-2026-05-07 Phase-4 red-team — production host-allowlist (HIGH#1),
 * CDN cross-alias bleed mitigation via `Vary: Host` (HIGH#2), stale-PDF
 * revalidation via ETag tied to `analytics.computed_at` (HIGH#3), and the
 * opaque-origin production hard-fail (MED#1).
 */
describe("GET /api/factsheet/[id]/pdf — production host allow-list + cache safety (audit-2026-05-07)", () => {
  let goto: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.mocked(checkLimit).mockReset();
    vi.mocked(checkLimit).mockResolvedValue({ success: true, retryAfter: 0 } as never);
    vi.mocked(createAdminClient).mockReset();
    singlePublishedComplete();

    const puppeteer = await import("@/lib/puppeteer");
    vi.mocked(puppeteer.acquirePdfSlot).mockResolvedValue(() => {});
    goto = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      goto,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setViewport: vi.fn().mockResolvedValue(undefined),
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(puppeteer.launchBrowser).mockResolvedValue({ newPage, close } as never);
  });

  afterEach(() => {
    process.env = { ...ENV_BACKUP };
  });

  it("HIGH#1: production VERCEL_ENV REJECTS a spoofed Host outside the allowlist (500, no puppeteer)", async () => {
    // Attacker-controlled Host: a self-hosted deploy, `vercel dev`, or a
    // proxy spoofing the `Host` header could otherwise drive puppeteer to
    // navigate to `https://evil.example.com/factsheet/<id>` with the
    // production deploy's full network privileges. Hard-fail prevents
    // the puppeteer slot from being acquired at all.
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://evil.example.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(500);
    // Critical anti-assertion: the puppeteer queue MUST NOT have been
    // acquired for a non-allowlisted host. Pre-fix, the route would
    // happily render against the attacker host.
    expect(goto).not.toHaveBeenCalled();
  });

  it("HIGH#1: production VERCEL_ENV accepts quantalyze-rho.vercel.app (allowlist positive control)", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze-rho.vercel.app/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto).toHaveBeenCalledTimes(1);
    expect(goto.mock.calls[0][0]).toBe(
      "https://quantalyze-rho.vercel.app/factsheet/00000000-0000-0000-0000-000000000001",
    );
  });

  it("HIGH#1: production VERCEL_ENV accepts the current deployment's VERCEL_URL (preview-branch allowance)", async () => {
    // Preview deployments get ephemeral hosts like
    // `quantalyze-abc123-team.vercel.app`. The allowlist would otherwise
    // reject them. Accepting the request's own deployment URL keeps
    // preview branches renderable without manual allowlist edits.
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_URL = "quantalyze-abc123-team.vercel.app";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze-abc123-team.vercel.app/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto.mock.calls[0][0]).toBe(
      "https://quantalyze-abc123-team.vercel.app/factsheet/00000000-0000-0000-0000-000000000001",
    );
  });

  it("MED#1: production VERCEL_ENV + opaque origin returns 500 (no env fallback fingerprint)", async () => {
    // Pre-fix, an opaque-origin request (Host stripped by an upstream
    // proxy) fell through to `NEXT_PUBLIC_APP_URL` in production. By
    // varying that env var to a sentinel host and observing 502 vs 200,
    // an attacker could fingerprint internal env state. The production
    // branch now hard-fails so the fallback is unreachable.
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_APP_URL = "https://sentinel.example.com";
    const { GET } = await import("./route");
    // Construct a request whose nextUrl.origin serializes as the literal
    // string "null" — matching the opaque-origin case the route guards.
    const req = {
      headers: new Headers(),
      nextUrl: { origin: "null" } as URL,
    } as unknown as NextRequest;
    const res = await GET(req, mkParams());
    expect(res.status).toBe(500);
    expect(goto).not.toHaveBeenCalled();
  });

  it("HIGH#2: 200 response carries Vary: Host so CDN keys per-host (cross-alias bleed mitigation)", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    // Vary: Host MUST be present — without it the shared CDN can serve
    // a preview-alias-generated PDF to a production-alias request.
    expect(res.headers.get("Vary")).toBe("Host");
  });

  it("HIGH#3: 200 response carries ETag bound to id:computed_at", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag");
    // Strong validator, quoted per RFC 7232. Format: id:computed_at.
    expect(etag).toBe(
      '"00000000-0000-0000-0000-000000000001:2026-05-17T00:00:00.000Z"',
    );
  });

  it("HIGH#3: If-None-Match matching the current ETag returns 304 without launching puppeteer", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      {
        method: "GET",
        headers: {
          "If-None-Match":
            '"00000000-0000-0000-0000-000000000001:2026-05-17T00:00:00.000Z"',
        },
      },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(304);
    // 304 must skip the expensive puppeteer render entirely — that's the
    // whole point of cache revalidation.
    expect(goto).not.toHaveBeenCalled();
    // Vary + Cache-Control must still be present on the 304 for the CDN
    // to use them on the revalidated entry.
    expect(res.headers.get("Vary")).toBe("Host");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("HIGH#3: If-None-Match with stale ETag (computed_at advanced) does NOT 304 — renders fresh PDF", async () => {
    // Strategy got recomputed → computed_at advances → ETag changes →
    // client's cached ETag no longer matches → must render fresh PDF.
    // Pre-fix, a stale PDF could pin in the CDN for up to 25h.
    process.env.VERCEL_ENV = "production";
    vi.mocked(createAdminClient).mockReset();
    singlePublishedComplete({ computed_at: "2026-05-17T12:00:00.000Z" });
    const { GET } = await import("./route");
    const req = new NextRequest(
      "https://quantalyze.com/api/factsheet/00000000-0000-0000-0000-000000000001/pdf",
      {
        method: "GET",
        headers: {
          // Stale ETag from a previous compute cycle.
          "If-None-Match":
            '"00000000-0000-0000-0000-000000000001:2026-05-17T00:00:00.000Z"',
        },
      },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(goto).toHaveBeenCalledTimes(1);
    expect(res.headers.get("ETag")).toBe(
      '"00000000-0000-0000-0000-000000000001:2026-05-17T12:00:00.000Z"',
    );
  });
});

/**
 * audit-2026-05-07 C-0090 — self-recursion fence on the factsheet PDF
 * route. The route launches a puppeteer that page.goto()'s the same
 * deployment's HTML factsheet page. To make recursion provably
 * impossible (and catch any future regression that introduces it), the
 * puppeteer page carries a custom User-Agent, and the route refuses any
 * inbound request whose UA matches that fingerprint.
 *
 * Two coverage points:
 *   1. Inbound request with the renderer UA → 508 Loop Detected, no
 *      rate-limit / DB / puppeteer touch.
 *   2. Successful render path stamps the renderer UA on the puppeteer
 *      page via setUserAgent BEFORE goto, so the inner request to
 *      /factsheet/[id] carries the fingerprint.
 */
describe("GET /api/factsheet/[id]/pdf — self-recursion fence (audit-2026-05-07 C-0090)", () => {
  let goto: ReturnType<typeof vi.fn>;
  let setUserAgent: ReturnType<typeof vi.fn>;

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
    setUserAgent = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      goto,
      setDefaultNavigationTimeout: vi.fn(),
      setDefaultTimeout: vi.fn(),
      setViewport: vi.fn().mockResolvedValue(undefined),
      setUserAgent,
      evaluate: vi.fn().mockResolvedValue(undefined),
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

  it("C-0090: request carrying the renderer User-Agent is refused with 508 Loop Detected", async () => {
    // Import to read the exported fingerprint — tests stay coupled to
    // the source constant so a future rename surfaces here loudly.
    const { GET, PDF_RENDERER_USER_AGENT } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${STRATEGY_ID}/pdf`,
      {
        method: "GET",
        headers: { "user-agent": PDF_RENDERER_USER_AGENT },
      },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(508);
    // Critical anti-assertions: the fence MUST short-circuit BEFORE
    // touching the rate limiter, Supabase, or puppeteer. Otherwise a
    // recursion would still burn the semaphore on every entry.
    expect(checkLimit).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
  });

  it("C-0090: puppeteer page is stamped with the renderer User-Agent BEFORE goto", async () => {
    // The setUserAgent call is the load-bearing piece: it propagates
    // the fingerprint onto every outbound request from puppeteer,
    // which lets the route reject re-entry at the fence above. If a
    // refactor reorders setUserAgent AFTER goto, the first navigation
    // would carry Chromium's default UA and the fence wouldn't catch
    // an in-page recursive PDF fetch. Assert the call order explicitly.
    const { GET, PDF_RENDERER_USER_AGENT } = await import("./route");
    const req = new NextRequest(
      `https://quantalyze.com/api/factsheet/${STRATEGY_ID}/pdf`,
      { method: "GET" },
    );
    const res = await GET(req, mkParams());
    expect(res.status).toBe(200);
    expect(setUserAgent).toHaveBeenCalledTimes(1);
    expect(setUserAgent).toHaveBeenCalledWith(PDF_RENDERER_USER_AGENT);
    // Ordering guard: setUserAgent's invocation order must precede
    // goto's. vi.fn tracks `.mock.invocationCallOrder` per fn.
    const setUaOrder = setUserAgent.mock.invocationCallOrder[0];
    const gotoOrder = goto.mock.invocationCallOrder[0];
    expect(setUaOrder).toBeLessThan(gotoOrder);
  });
});
