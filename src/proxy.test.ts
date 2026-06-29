import { describe, it, expect, vi, beforeEach } from "vitest";
import { config, proxy } from "./proxy";
import { NextRequest } from "next/server";

/**
 * Unit tests for the proxy middleware matcher config.
 *
 * The matcher pattern controls which paths Next.js runs the middleware on.
 * Tests verify:
 *   - Static asset bypasses (should NOT be guarded)
 *   - Known public-doc bypasses: security.txt, robots.txt, .well-known/,
 *     *.pdf (should NOT be guarded)
 *   - Auth-required routes (should be GUARDED — i.e. pattern MATCHES them)
 *   - S1 fix: /unknown.txt is now GUARDED (not bypassed)
 *
 * Method: extract the regex string from config.matcher[0], build a RegExp,
 * then assert which paths match (guarded) vs. do not match (bypassed).
 *
 * Added for review finding I2.
 */

// config.matcher[0] is the raw string from the Next.js matcher array.
// Next.js compiles it internally; here we exercise the pattern directly
// to verify intent, not the compiled output.
const pattern = config.matcher[0];
// Strip surrounding /( and )/ to get the inner negative-lookahead pattern.
const regex = new RegExp(`^${pattern}$`);

function isGuarded(path: string): boolean {
  return regex.test(path);
}

describe("proxy matcher config", () => {
  // ---------------------------------------------------------------------------
  // Bypassed paths (middleware should NOT run — pattern does not match)
  // ---------------------------------------------------------------------------
  describe("bypasses (not guarded)", () => {
    it.each([
      "/security.txt",
      "/robots.txt",
      "/.well-known/security.txt",
      "/.well-known/anything",
      "/security-packet.pdf",
      "/some-document.pdf",
      "/_next/static/foo.js",
      "/_next/static/chunks/main.js",
      "/_next/image?url=foo",
      "/favicon.ico",
      "/logo.svg",
      "/og-image.png",
      "/bg.jpg",
      "/cover.jpeg",
      "/animation.gif",
      "/hero.webp",
    ])("bypasses %s", (path) => {
      expect(isGuarded(path)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Guarded paths (middleware SHOULD run — pattern matches)
  // ---------------------------------------------------------------------------
  describe("guards (middleware runs)", () => {
    it.each([
      // S1 fix: arbitrary .txt files are no longer bypassed
      "/unknown.txt",
      "/data/dump.txt",
      // Auth-required app routes
      "/security",
      "/security/",
      "/dashboard",
      "/dashboard/portfolio",
      "/api/foo",
      "/api/cron/sync-funding",
      "/login",
      "/signup",
      "/discovery/crypto-sma",
      "/admin",
    ])("guards %s", (path) => {
      expect(isGuarded(path)).toBe(true);
    });
  });
});

/**
 * Behavioral test for the cron bypass added in the post-landing hotfix.
 *
 * Pre-fix, every `/api/cron/*` request hit the session check and was 307'd
 * to `/login` because Vercel Cron orchestrator doesn't carry a Supabase
 * session cookie. The cron handler's own `Authorization: Bearer
 * ${CRON_SECRET}` check was unreachable, so all crons silently no-op'd
 * (Vercel saw a 200 on /login and assumed success). This regression test
 * fails pre-fix and passes post-fix.
 *
 * Mocks @supabase/ssr so the test does not need a live Supabase URL — but
 * the whole point of the bypass is to short-circuit BEFORE that client is
 * constructed, so the mock should never actually be invoked for a cron
 * path.
 */
vi.mock("@supabase/ssr", () => ({
  // If the bypass works, this mock is never called. If the bypass regresses,
  // proxy() still works because we return a valid client shape here.
  createServerClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  })),
}));

describe("proxy /api/cron bypass", () => {
  // Deliberately NO env stubs and NO mock setup here. If the bypass regresses,
  // the test must FAIL LOUDLY — falling through to the @supabase/ssr mock
  // (which would happen if env stubs let createServerClient succeed) silently
  // masks the regression. The non-cron sibling tests below need the stubs
  // because they DO exercise the session path; scope them there.

  // The bypass uses `path.startsWith("/api/cron/")` — a prefix check, not a
  // whitelist. One representative path under that prefix is enough to verify
  // the predicate. Per-cron coverage is a drift-risk illusion: vercel.json's
  // 6 cron entries are the source of truth for what's scheduled, not this
  // file. Cover both verbs (Vercel Cron dispatches GET; manual ops typically
  // POST) since the bypass MUST be method-agnostic.
  it.each([
    ["GET", "/api/cron/founder-lp-report"],
    ["POST", "/api/cron/founder-lp-report"],
    // A sibling path proves the prefix, not that founder-lp-report is special.
    ["GET", "/api/cron/sync-funding"],
  ])(
    "%s %s bypasses the session gate (cron self-auths via Bearer)",
    async (method, path) => {
      const req = new NextRequest(`https://example.com${path}`, {
        method,
        headers: { authorization: "Bearer test-secret" },
      });
      const res = await proxy(req);
      // NextResponse.next() is exactly 200. A regression that swapped the
      // bypass for a redirect or a custom status would change this.
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  // Pin the predicate's edges. A future contributor who writes
  // `pathname.startsWith("/api/cron")` (drop the trailing slash, "cleaner")
  // must NOT inherit the bypass for sibling-named routes or path-parameter
  // tricks. Each of these MUST go through the session gate.
  describe("paths that look like cron but must NOT bypass", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
    });

    it.each([
      "/api/cronjobs", // sibling-named route, no separator
      "/api/cronx/admin", // sibling-prefixed nested route
      "/api/cron-foo", // hyphenated sibling
      "/api/cron;param=evil/admin", // path-parameter trick
    ])("%s falls through to the session gate", async (path) => {
      const { createServerClient } = await import("@supabase/ssr");
      const req = new NextRequest(`https://example.com${path}`, {
        method: "GET",
      });
      await proxy(req);
      expect(vi.mocked(createServerClient)).toHaveBeenCalled();
    });
  });

  it("non-cron API routes still go through the session gate", async () => {
    // Sanity check that the bypass is targeted, not a blanket /api skip.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
    const { createServerClient } = await import("@supabase/ssr");
    vi.mocked(createServerClient).mockClear();
    const req = new NextRequest("https://example.com/api/admin/users", {
      method: "GET",
    });
    await proxy(req);
    // The session-gated path constructs the supabase client; bypass would
    // skip this. Mock-call evidence proves the bypass did NOT fire.
    expect(vi.mocked(createServerClient)).toHaveBeenCalled();
  });
});

/**
 * Public-route gating: substring-attack hardening + exact-match '/' guard.
 *
 * Audit 2026-05-07 findings:
 *   - C-0186 (c8): No coverage for new public-route additions ('/demo',
 *     '/api/demo'), no coverage for substring-attack hardening (the
 *     `path === route || startsWith(route + '/')` shape was added to block
 *     `/demonstration` from matching `/demo`).
 *   - C-0187 (c7): The `path === '/'` exact-match branch is the load-bearing
 *     piece that lets the public-route OR-chain not match every authenticated
 *     path (every path starts with '/'). A regression that drops the `===`
 *     guard would open the entire dashboard.
 *
 * Predicate under test (src/proxy.ts):
 *     const isPublicRoute =
 *       path === "/" ||
 *       PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
 *
 * With no session:
 *   - public route       → `next()` (200, no redirect)
 *   - non-public route   → 307 to /login
 */
describe("proxy public-route gating (anonymous session)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
  });

  // ---------- Allowed (public) — should NOT redirect ----------
  describe("anonymous request to a public route falls through (no redirect)", () => {
    it.each([
      // C-0187: exact-match '/' is the home page; everything starts with '/',
      // so this MUST be tested with an exact-equality predicate, not a
      // prefix.
      "/",
      // New public-route additions added with the substring-hardening patch
      // (C-0186).
      "/demo",
      "/demo/match/abc-123",
      "/api/demo/match/abc-123",
      // Pre-existing public routes — pin them so future PUBLIC_ROUTES edits
      // don't silently drop one.
      "/login",
      "/signup",
      // 51-REVIEW (#512 fix): an anon user clicking "Forgot password?" on the
      // login page MUST reach /forgot-password, not 307→login (the dead loop
      // that left password reset unreachable for logged-out users).
      // /reset-password is public so a bare anon hit renders the "request a new
      // link" affordance instead of bouncing.
      "/forgot-password",
      "/reset-password",
      "/legal/disclaimer",
      "/browse",
      "/browse/crypto-sma",
      "/factsheet/abc-123",
      "/api/factsheet/abc-123/pdf",
      "/portfolio-pdf",
      // SHARE-02/03 (v0.26.0.0 follow-up): the public recipient page AND its
      // server-side BTC benchmark fetch (page.tsx fetches /api/benchmark/btc
      // cookie-lessly) must render for ANONYMOUS recipients — a share link is
      // for people without accounts. Pre-fix proxy.ts omitted both from
      // PUBLIC_ROUTES, so anon hit 307 → /login and the feature was dead.
      "/scenario-share/abc-token-123",
      "/api/benchmark/btc",
      "/for-quants",
      "/for-quants/about",
      "/security",
      "/security/contact",
    ])("%s → next() (no redirect)", async (path) => {
      const req = new NextRequest(`https://example.com${path}`, {
        method: "GET",
      });
      const res = await proxy(req);
      // next() resolves to a 200 response with no `location` header. A
      // redirect would surface as 307 with a location.
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });
  });

  // ---------- Blocked (private) — MUST redirect to /login ----------
  describe("anonymous request to a non-public route redirects to /login", () => {
    it.each([
      // Authenticated dashboard surfaces.
      "/dashboard",
      "/dashboard/portfolio",
      "/discovery/crypto-sma",
      "/discovery/momentum/abc-123",
      "/admin",
      "/admin/strategies",
      // C-0186 substring-attack guards. These MUST redirect: the public-route
      // predicate uses `path === route || path.startsWith(route + "/")`, NOT
      // bare `path.startsWith(route)`. A regression that swaps the predicate
      // for the bare prefix would let any of these slip through.
      "/demonstration", // looks like /demo but is a sibling path
      "/demo-other", // hyphenated sibling, no separator
      "/loginx", // sibling of /login, no separator
      "/signupwizard", // sibling of /signup
      "/api/demo-evil", // looks like /api/demo but is a sibling
      "/api/factsheetx", // sibling of /api/factsheet
      "/browseFAKE", // C-0187: sibling of /browse — must NOT match
      "/legalese", // sibling of /legal
      "/securityaudit", // sibling of /security
      "/for-quants-eval", // sibling of /for-quants
      // SHARE-02/03 sibling-bypass guards. The new /scenario-share +
      // /api/benchmark/btc public entries use the same `=== route ||
      // startsWith(route + "/")` predicate; these siblings MUST still 307 so a
      // future regression to a bare `startsWith(route)` is caught loudly.
      "/scenario-shareEVIL", // sibling of /scenario-share, no separator
      "/scenario-share-x", // hyphenated sibling
      "/api/benchmark/btc-evil", // sibling of /api/benchmark/btc, no separator
      "/api/benchmarkX", // sibling of the /api/benchmark/btc parent
      // Authenticated API.
      "/api/keys-management/rotate", // sibling of /api/keys
      "/api/portfolios/list",
    ])("%s → 307 redirect to /login", async (path) => {
      const req = new NextRequest(`https://example.com${path}`, {
        method: "GET",
      });
      const res = await proxy(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).not.toBeNull();
      // The redirect URL preserves the host; assert by URL path equality
      // rather than full-string match so test stays resilient to host stub.
      expect(new URL(location!).pathname).toBe("/login");
    });
  });

  // ---------- Marketing-exempt branch (signed-in user on /demo, /for-quants, /security) ----------
  describe("authenticated user on marketing-exempt routes stays on the page", () => {
    // The session branch needs a session object — re-mock just for this
    // sub-block. The existing top-level mock returns `session: null`; here
    // we install a session with an authenticated user.
    beforeEach(async () => {
      const { createServerClient } = await import("@supabase/ssr");
      vi.mocked(createServerClient).mockImplementation(
        () =>
          ({
            auth: {
              getSession: vi.fn().mockResolvedValue({
                data: {
                  session: {
                    user: { id: "u1", email: "alice@example.com" },
                  },
                },
              }),
            },
          }) as unknown as ReturnType<typeof createServerClient>,
      );
    });

    it.each([
      "/demo",
      "/demo/match/abc-123",
      "/for-quants",
      "/for-quants/about",
      "/security",
      "/security/contact",
      // 2026-05-17 UAT regression — these are public-routes (so unauthed
      // share-link viewers can render them) AND must be reachable by the
      // authed user who clicked the in-app button. Pre-fix, the proxy
      // redirected authed users to /discovery/crypto-sma, making the
      // "Factsheet" button on the strategy detail page reroute to the
      // discovery overview. Pin the fix.
      "/factsheet",
      "/factsheet/abc-123",
      "/strategy",
      "/strategy/abc-123",
      "/browse",
      "/browse/sub",
      "/portfolio-pdf",
      "/portfolio-pdf/abc-123",
      // SHARE-02/03: a share link is a shared artifact — an authenticated
      // viewer (the sharer verifying their own link, or a logged-in LP) must
      // see the recipient page, not bounce to /discovery/crypto-sma.
      "/scenario-share/abc-token-123",
      "/legal",
      "/legal/privacy",
      // 51-REVIEW: /reset-password is bounce-exempt — it is reached WITH a
      // recovery session (minted by /auth/callback from the email token), so an
      // authed user there must STAY to set the new password, not bounce to the
      // dashboard. (/forgot-password is NOT exempt — see the dedicated test
      // below — so an authed user there bounces away, matching /login.)
      "/reset-password",
    ])(
      "%s with session does NOT redirect to dashboard",
      async (path) => {
        const req = new NextRequest(`https://example.com${path}`, {
          method: "GET",
        });
        const res = await proxy(req);
        // The auth-bounce-exempt branch keeps the user on the page (200),
        // even though `isPublicRoute && session` would otherwise redirect
        // to the default authenticated route.
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();
      },
    );

    it("authenticated user on /login DOES redirect away (not marketing-exempt)", async () => {
      // Sanity: prove the marketing-exempt branch is targeted, not a blanket
      // public-route skip. /login is public but NOT marketing-exempt — an
      // authenticated user bouncing back to /login must be redirected to
      // the default authenticated route.
      const req = new NextRequest(`https://example.com/login`, {
        method: "GET",
      });
      const res = await proxy(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).not.toBeNull();
      // Default authenticated route per src/proxy.ts.
      expect(new URL(location!).pathname).toBe("/discovery/crypto-sma");
    });

    it("authenticated user on /forgot-password DOES redirect away (not bounce-exempt)", async () => {
      // 51-REVIEW: /forgot-password is public (anon must reach it) but NOT
      // bounce-exempt — an already-authed user there has no reason to request a
      // password reset, so they bounce to the dashboard exactly like /login and
      // /signup. (/reset-password IS exempt — pinned in the it.each above — so
      // the authed-recovery flow is not broken by this.)
      const req = new NextRequest(`https://example.com/forgot-password`, {
        method: "GET",
      });
      const res = await proxy(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).not.toBeNull();
      expect(new URL(location!).pathname).toBe("/discovery/crypto-sma");
    });
  });
});

/**
 * Red-team invariant pins (audit-2026-05-07 RT4):
 *
 * 1. PUBLIC_ROUTES entries MUST NOT carry a trailing slash. The public-route
 *    predicate is `path === route || path.startsWith(route + "/")`. A
 *    typo-prone entry like `"/factsheet/"` (trailing slash) would make
 *    `route + "/"` compute as `/factsheet//` — failing the canonical
 *    `/factsheet/abc` match.
 * 2. The `path === route` exact-match branch is load-bearing: without it,
 *    `/factsheet` (no trailing component) would 307 to /login because
 *    `path.startsWith("/factsheet/")` is false for the bare path.
 *
 * We assert behavior via proxy() rather than importing PUBLIC_ROUTES to
 * avoid widening the export surface.
 */
describe("proxy public-route invariant (red-team RT4)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // The marketing-exempt sub-block above replaced the createServerClient
    // implementation with a session-returning shape. clearAllMocks() clears
    // .mock.calls/.mock.results but NOT mockImplementation — so we must
    // explicitly re-install the anonymous-session shape so the proxy sees
    // session=null in this block.
    const { createServerClient } = await import("@supabase/ssr");
    vi.mocked(createServerClient).mockImplementation(
      () =>
        ({
          auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
          },
        }) as unknown as ReturnType<typeof createServerClient>,
    );
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "stub-anon-key";
  });

  it("canonical /factsheet/:id stays public regardless of trailing slash drift", async () => {
    const req = new NextRequest(`https://example.com/factsheet/abc-123`, {
      method: "GET",
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("exact /factsheet (no trailing component) stays public", async () => {
    // Documents the `path === route` exact-match branch on the public-route
    // predicate — without it, `/factsheet` (no suffix) would redirect to
    // /login because `startsWith("/factsheet/")` requires the trailing
    // slash and `/factsheet` doesn't have one.
    const req = new NextRequest(`https://example.com/factsheet`, {
      method: "GET",
    });
    const res = await proxy(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
