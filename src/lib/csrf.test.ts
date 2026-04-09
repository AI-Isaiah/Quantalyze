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

  it("returns 403 when Origin header is missing", async () => {
    const req = makeRequest({});
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
  });

  it("returns 403 when Origin host is not in allowlist", async () => {
    const req = makeRequest({ origin: "https://evil.example.com" });
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
  });

  it("accepts Referer as fallback when Origin is missing", async () => {
    const req = makeRequest({ referer: "http://localhost:3000/some/page" });
    expect(assertSameOrigin(req)).toBeNull();
  });

  it("returns 403 when Origin is an invalid URL", async () => {
    const req = makeRequest({ origin: "not-a-url" });
    const result = assertSameOrigin(req);
    expect(result?.status).toBe(403);
  });
});
