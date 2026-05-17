import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertSameOrigin, __resetAllowedHostsForTest } from "./csrf";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    headers: new Headers(headers),
    method: "POST",
  });
}

describe("assertSameOrigin", () => {
  beforeEach(() => {
    // vi.stubEnv works around `process.env.NODE_ENV` being typed as
    // read-only by @types/node. The stubs are auto-restored between tests.
    vi.stubEnv("NODE_ENV", "development");
    __resetAllowedHostsForTest();
  });

  it("returns null when Origin matches localhost in dev", async () => {
    const req = makeRequest({ origin: "http://localhost:3000" });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("returns 403 + Cache-Control when Origin header is missing", async () => {
    const req = makeRequest({});
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
    expect(result?.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 403 + Cache-Control when Origin host is not in allowlist", async () => {
    const req = makeRequest({ origin: "https://evil.example.com" });
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
    expect(result?.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("accepts Referer as fallback when Origin is missing", async () => {
    const req = makeRequest({ referer: "http://localhost:3000/some/page" });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("returns 403 + Cache-Control when Origin is an invalid URL", async () => {
    const req = makeRequest({ origin: "not-a-url" });
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
    expect(result?.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // Red-team 2026-05-17 (red-team:custom-domain-frozen-allowlist, MED
  // conf 8): NEXT_PUBLIC_ALLOWED_ORIGINS supports comma-separated extra
  // hosts so a future custom-domain rollout doesn't 403 every cross-
  // domain manager request with a misleading permission-style error.
  it("accepts hosts from NEXT_PUBLIC_ALLOWED_ORIGINS (custom-domain rollout support)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://quantalyze-rho.vercel.app");
    vi.stubEnv(
      "NEXT_PUBLIC_ALLOWED_ORIGINS",
      "https://quantalyze.com,https://www.quantalyze.com",
    );
    __resetAllowedHostsForTest();
    // Primary site URL still passes.
    expect(
      assertSameOrigin(
        makeRequest({ origin: "https://quantalyze-rho.vercel.app" }),
      ),
    ).toBeNull();
    // Custom domain (configured via NEXT_PUBLIC_ALLOWED_ORIGINS) passes.
    expect(
      assertSameOrigin(makeRequest({ origin: "https://quantalyze.com" })),
    ).toBeNull();
    expect(
      assertSameOrigin(
        makeRequest({ origin: "https://www.quantalyze.com" }),
      ),
    ).toBeNull();
    // A different host is still rejected — the allowlist isn't a wildcard.
    expect(
      assertSameOrigin(makeRequest({ origin: "https://evil.example.com" }))
        ?.status,
    ).toBe(403);
  });

  it("tolerates bare-host entries in NEXT_PUBLIC_ALLOWED_ORIGINS (no scheme)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://quantalyze-rho.vercel.app");
    vi.stubEnv("NEXT_PUBLIC_ALLOWED_ORIGINS", "quantalyze.com");
    __resetAllowedHostsForTest();
    expect(
      assertSameOrigin(makeRequest({ origin: "https://quantalyze.com" })),
    ).toBeNull();
  });
});
