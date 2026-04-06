import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/keys", "/api/trades"];
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

  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    PUBLIC_ROUTES.some((route) => request.nextUrl.pathname.startsWith(route));

  if (!session && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const isApiRoute = request.nextUrl.pathname.startsWith("/api/");
  if (session && isPublicRoute && !isApiRoute) {
    const redirect = request.nextUrl.searchParams.get("redirect");
    const safePath = redirect && /^\/[a-z]/.test(redirect) ? redirect : DEFAULT_AUTHENTICATED_ROUTE;
    const url = request.nextUrl.clone();
    url.pathname = safePath;
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  // Admin route protection (optimistic check by email from JWT)
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
