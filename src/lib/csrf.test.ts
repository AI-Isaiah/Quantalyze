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

  // M-0900: NEXT_PUBLIC_VERCEL_URL is read (csrf.ts:60-65) so per-PR
  // preview deployments don't 403 every allocator/admin POST. Vercel
  // exposes this WITHOUT a scheme (host only), so the code wraps it in
  // `https://${vercelUrl}`. These tests pin both the positive match and
  // the graceful-skip on a malformed value — a regression dropping the
  // env read (or mis-parsing) would silently re-break preview testing.
  it("accepts an Origin matching the NEXT_PUBLIC_VERCEL_URL preview host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_URL", "quantalyze-pr-55-abc123.vercel.app");
    __resetAllowedHostsForTest();
    expect(
      assertSameOrigin(
        makeRequest({ origin: "https://quantalyze-pr-55-abc123.vercel.app" }),
      ),
    ).toBeNull();
    // A non-preview host is still rejected — VERCEL_URL is not a wildcard.
    expect(
      assertSameOrigin(makeRequest({ origin: "https://evil.example.com" }))
        ?.status,
    ).toBe(403);
  });

  it("skips a malformed NEXT_PUBLIC_VERCEL_URL without crashing buildAllowedHosts", async () => {
    // `https://%%not-a-host%%` is an invalid URL — the try/catch in
    // buildAllowedHosts must swallow it so the rest of the allowlist
    // (here, dev localhost) still works and assertSameOrigin never throws.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_URL", "%%not-a-host%%");
    expect(() => __resetAllowedHostsForTest()).not.toThrow();
    const req = makeRequest({ origin: "http://localhost:3000" });
    expect(() => assertSameOrigin(req)).not.toThrow();
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("WARNS (does not silently swallow) a malformed NEXT_PUBLIC_VERCEL_URL", () => {
    // M-0901: the Vercel branch used to drop a malformed value silently while
    // its two sibling branches (NEXT_PUBLIC_SITE_URL,
    // NEXT_PUBLIC_ALLOWED_ORIGINS) warned. A silent skip 403s every preview
    // POST with no operator-visible reason. The intent is to make the misconfig
    // greppable, so assert the warn FIRES — not merely that it doesn't throw.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PUBLIC_VERCEL_URL", "%%not-a-host%%");
      __resetAllowedHostsForTest();
      expect(warnSpy).toHaveBeenCalledWith(
        "[csrf] NEXT_PUBLIC_VERCEL_URL is not a valid host:",
        "%%not-a-host%%",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
