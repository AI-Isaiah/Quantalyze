import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
// audit-2026-05-07 C-0144 + C-0150: `isAdmin(email)` is no longer used by
// the proxy gate (see admin-route block below). Page-level `isAdminUser` is
// the authoritative check.

const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/scenario-share", "/api/benchmark/btc", "/legal", "/demo", "/api/demo", "/for-quants", "/api/for-quants-lead", "/security"];
const ADMIN_ROUTES = ["/admin", "/api/admin"];
const DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma";

export async function proxy(request: NextRequest) {
  // Vercel Cron orchestrator + manual ops POSTs to /api/cron/* arrive without
  // a session cookie. Each cron route handler self-authenticates with a
  // timing-safe `Authorization: Bearer ${CRON_SECRET}` compare. If we let
  // them fall through to the session check below, the proxy 307s them to
  // /login — which Vercel's cron pings see as a 200 on the login page,
  // so cron failures are silent. Bypass the session path entirely; the
  // route's own auth gate is the source of truth for cron access.
  if (request.nextUrl.pathname.startsWith("/api/cron/")) {
    return NextResponse.next({ request });
  }

  const supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Optimistic session check (cookie-only, no network call).
  // Authoritative getUser() should be called in server components/DAL.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // Strict route matching: `path === route` handles exact matches and
  // `startsWith(route + "/")` handles nested routes. This prevents false
  // positives where `/demo` would accidentally match `/demonstration`.
  const path = request.nextUrl.pathname;
  const isPublicRoute =
    path === "/" ||
    PUBLIC_ROUTES.some((route) => path === route || path.startsWith(route + "/"));

  if (!session && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const isApiRoute = path.startsWith("/api/");
  // Exclude routes from the logged-in redirect branch.
  //
  // Two intents here:
  //
  //   (a) Marketing surfaces (`/demo`, `/for-quants`, `/security`) — admins
  //       and founders viewing the public marketing pages while signed in,
  //       or sharing the landing page with a colleague, stay on the page
  //       instead of being bounced to the dashboard.
  //
  //   (b) Shared artifacts (`/factsheet/:id`, `/strategy/:id`, `/browse`,
  //       `/portfolio-pdf/:id`, `/scenario-share/:token`) — these live in
  //       PUBLIC_ROUTES so unauthed
  //       users following a shared link can render them, but authenticated
  //       users ALSO need to view them (a logged-in allocator clicking the
  //       "Factsheet" button on a strategy detail page must NOT be yanked
  //       back to /discovery/crypto-sma). Pre-2026-05-17 these were lumped
  //       into PUBLIC_ROUTES with no exemption, so authed users hit a
  //       silent redirect — symptom: factsheet button reroutes to discovery.
  //
  // The non-exempt public routes are `/login` and `/signup` — those SHOULD
  // bounce authed users back to the dashboard (no point seeing the login
  // form once you're in). The test at "authenticated user on /login DOES
  // redirect away" pins that intent.
  const isDemoRoute = path === "/demo" || path.startsWith("/demo/");
  const isForQuantsRoute =
    path === "/for-quants" || path.startsWith("/for-quants/");
  const isSecurityRoute =
    path === "/security" || path.startsWith("/security/");
  const isFactsheetRoute =
    path === "/factsheet" || path.startsWith("/factsheet/");
  const isStrategyRoute =
    path === "/strategy" || path.startsWith("/strategy/");
  const isBrowseRoute = path === "/browse" || path.startsWith("/browse/");
  const isPortfolioPdfRoute =
    path === "/portfolio-pdf" || path.startsWith("/portfolio-pdf/");
  const isLegalRoute = path === "/legal" || path.startsWith("/legal/");
  const isScenarioShareRoute =
    path === "/scenario-share" || path.startsWith("/scenario-share/");
  const isAuthBounceExempt =
    isDemoRoute ||
    isForQuantsRoute ||
    isSecurityRoute ||
    isFactsheetRoute ||
    isStrategyRoute ||
    isBrowseRoute ||
    isPortfolioPdfRoute ||
    isLegalRoute ||
    isScenarioShareRoute;
  if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safePath = redirect && /^\/[a-z]/.test(redirect) ? redirect : DEFAULT_AUTHENTICATED_ROUTE;
    const url = request.nextUrl.clone();
    url.pathname = safePath;
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  // audit-2026-05-07 C-0144 + C-0150: the previous proxy-level email-only
  // check redirected any admin whose email did NOT match ADMIN_EMAIL away
  // from /admin/* — locking out DB-admins whose profiles.is_admin=TRUE but
  // whose email isn't in the env var (the exact "DB-only admin" persona the
  // RBAC refactor was supposed to protect). The proxy now does NOT enforce
  // admin status: page-level `isAdminUser` is the authoritative gate
  // (matches RLS) and reliably returns 403 for non-admins. We accept the
  // cost of one DB call to load the page-level gate for non-admin probes;
  // the alternative (proxy DB call) trades one cost for another and adds
  // proxy-level Supabase coupling. The matching-ADMIN_EMAIL fast-pass is
  // gone — if it's needed back later, add it as a positive allowlist (fast
  // pass through), never as a deny.
  // `ADMIN_ROUTES` retained for future use (e.g. logging an access-attempt
  // probe at the proxy level without changing the response).
  void ADMIN_ROUTES;

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Skip Next internal assets, favicon, common image extensions, and the
    // specific static documents the marketing surface depends on (RFC 9116
    // security.txt + the downloadable security packet PDF). The .txt bypass is
    // intentionally scoped to (security.txt|robots.txt) — a broad `.*\.txt$`
    // pattern would let any unknown .txt path bypass auth. /unknown.txt stays
    // guarded after this change. Next.js 16 rejects capturing groups in the
    // matcher source, so the alternation uses the non-capturing `(?:…)` form.
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf)$|(?:security|robots)\\.txt$).*)",
  ],
};
