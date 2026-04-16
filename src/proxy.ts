import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdmin } from "@/lib/admin";

const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/legal", "/demo", "/api/demo", "/for-quants", "/api/for-quants-lead", "/security"];
const ADMIN_ROUTES = ["/admin", "/api/admin"];
const DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma";

export async function proxy(request: NextRequest) {
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
  // Exclude `/demo/*`, `/for-quants/*`, and `/security/*` from the logged-in
  // redirect branch so admins/founders viewing public marketing surfaces
  // while signed in (or managers sharing the landing page with a colleague)
  // stay on those pages instead of being bounced to the dashboard.
  const isDemoRoute = path === "/demo" || path.startsWith("/demo/");
  const isForQuantsRoute =
    path === "/for-quants" || path.startsWith("/for-quants/");
  const isSecurityRoute =
    path === "/security" || path.startsWith("/security/");
  const isMarketingExempt = isDemoRoute || isForQuantsRoute || isSecurityRoute;
  if (session && isPublicRoute && !isApiRoute && !isMarketingExempt) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safePath = redirect && /^\/[a-z]/.test(redirect) ? redirect : DEFAULT_AUTHENTICATED_ROUTE;
    const url = request.nextUrl.clone();
    url.pathname = safePath;
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  // Admin route protection: fast-path email check via the canonical isAdmin()
  // helper in lib/admin.ts. This bounces non-admin users early without a DB
  // call. The authoritative check (isAdminUser) at the page/API handler level
  // also queries profiles.is_admin, so DB-only admins still pass at the DAL
  // layer — they just won't be blocked here at the proxy level.
  const isAdminRoute = ADMIN_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );
  if (isAdminRoute) {
    if (!isAdmin(session?.user?.email)) {
      const url = request.nextUrl.clone();
      url.pathname = DEFAULT_AUTHENTICATED_ROUTE;
      return NextResponse.redirect(url);
    }
  }

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
