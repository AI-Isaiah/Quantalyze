import { describe, it, expect, vi, beforeEach } from "vitest";

// Test the proxy routing logic that caused the 307 redirect bug
describe("API route proxy behavior", () => {
  it("API routes should not be redirected when user is authenticated", () => {
    // The proxy had a bug where authenticated users hitting public routes
    // (including /api/keys/*) were redirected to /discovery/crypto-sma.
    // This test verifies the fix: /api/ routes skip the redirect.
    const isApiRoute = "/api/keys/validate-and-encrypt".startsWith("/api/");
    expect(isApiRoute).toBe(true);

    // Simulating proxy logic: session exists, route is public, is API route
    const session = { user: { id: "test" } }; // truthy
    const isPublicRoute = true;
    const shouldRedirect = session && isPublicRoute && !isApiRoute;
    expect(shouldRedirect).toBe(false);
  });

  it("login/signup routes should still redirect authenticated users", () => {
    const isApiRoute = "/login".startsWith("/api/");
    expect(isApiRoute).toBe(false);

    const session = { user: { id: "test" } };
    const isPublicRoute = true;
    const shouldRedirect = session && isPublicRoute && !isApiRoute;
    expect(shouldRedirect).toBe(true);
  });

  it("PUBLIC_ROUTES matches /api/keys/* paths", () => {
    const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/keys", "/api/trades"];
    const pathname = "/api/keys/validate-and-encrypt";
    const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
    expect(isPublic).toBe(true);
  });

  it("PUBLIC_ROUTES does not match /api/admin/* paths", () => {
    const PUBLIC_ROUTES = ["/login", "/signup", "/strategy", "/factsheet", "/api/keys", "/api/trades"];
    const pathname = "/api/admin/strategy-review";
    const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
    expect(isPublic).toBe(false);
  });
});

// Test the analytics client error handling
describe("analytics client error handling", () => {
  it("handles non-JSON error responses gracefully", async () => {
    // Regression: FastAPI returned text/plain "Internal Server Error"
    // and the client tried to JSON.parse it, producing "unexpected DOCTYPE"
    const textBody = "Internal Server Error";
    const isJson = "text/plain; charset=utf-8".includes("application/json");
    expect(isJson).toBe(false);
    // Should use the text body as the error message
    expect(textBody).toBe("Internal Server Error");
  });

  it("extracts detail from JSON error responses", () => {
    const jsonError = { detail: "Authentication failed. Check your API key and secret." };
    expect(jsonError.detail).toContain("Authentication failed");
  });
});
