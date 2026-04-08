import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/factsheet", "/browse", "/api/keys", "/api/trades", "/api/verify-strategy", "/api/alert-digest", "/portfolio-pdf", "/legal", "/demo", "/api/demo"];
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
  // Exclude `/demo/*` from the logged-in redirect branch so admins/founders
  // viewing the public demo while signed in stay on the demo page instead of
  // being bounced to the dashboard.
  const isDemoRoute = path === "/demo" || path.startsWith("/demo/");
  if (session && isPublicRoute && !isApiRoute && !isDemoRoute) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safePath = redirect && /^\/[a-z]/.test(redirect) ? redirect : DEFAULT_AUTHENTICATED_ROUTE;
    const url = request.nextUrl.clone();
    url.pathname = safePath;
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  // Admin route protection: optimistic email check from JWT (can't query DB cheaply here).
  // This is a fast-path that bounces non-admin users early. The authoritative check uses
  // isAdminUser() at the page/API handler level (DAL pattern), which ALSO checks
  // profiles.is_admin = true. As of migration 011 the only admin is the founder whose
  // email matches ADMIN_EMAIL AND who has is_admin = true after backfill, so the cheap
  // proxy check is sufficient. When a 2nd admin is added with is_admin = true but a
  // different email, this proxy check needs a JWT custom claim or a session cache.
  // Tracked in TODOS.md (P2: drop email-based gate).
  const isAdminRoute = ADMIN_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  );
  if (isAdminRoute) {
    const adminEmail = process.env.ADMIN_EMAIL ?? "";
    const email = session?.user?.email ?? "";
    if (!adminEmail || email.toLowerCase() !== adminEmail.toLowerCase()) {
      const url = request.nextUrl.clone();
      url.pathname = DEFAULT_AUTHENTICATED_ROUTE;
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
