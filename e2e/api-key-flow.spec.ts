import { test, expect } from "@playwright/test";

test.describe("API Key Connection Flow", () => {
  test("validate-and-encrypt endpoint returns JSON, not HTML redirect", async ({ request }) => {
    // Regression: proxy was 307-redirecting authenticated /api/keys/* calls
    // to /discovery/crypto-sma (HTML page), causing "unexpected DOCTYPE" error
    const res = await request.post("/api/keys/validate-and-encrypt", {
      data: { exchange: "binance", api_key: "test", api_secret: "test" },
    });

    // Should be JSON (either 401 Unauthorized or 400 Bad Request), never HTML
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");

    // Status should NOT be 307 (redirect)
    expect(res.status()).not.toBe(307);

    // Body should be parseable JSON
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("validate-and-encrypt returns proper error for invalid credentials", async ({ request }) => {
    // Without auth, should get 401
    const res = await request.post("/api/keys/validate-and-encrypt", {
      data: {
        exchange: "okx",
        api_key: "fake-key",
        api_secret: "fake-secret",
        passphrase: "fake-pass",
      },
    });

    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("validate-and-encrypt rejects missing fields", async ({ request }) => {
    const res = await request.post("/api/keys/validate-and-encrypt", {
      data: { exchange: "binance" },
    });

    // Either 401 (no auth) or 400 (missing fields) -- both are JSON
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
  });

  test("sync endpoint returns JSON, not redirect", async ({ request }) => {
    const res = await request.post("/api/keys/sync", {
      data: { strategy_id: "00000000-0000-0000-0000-000000000000" },
    });

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    expect(res.status()).not.toBe(307);
  });

  test("trades upload endpoint returns JSON, not redirect", async ({ request }) => {
    const res = await request.post("/api/trades/upload", {
      data: { strategy_id: "test", trades: [] },
    });

    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    expect(res.status()).not.toBe(307);
  });
});
