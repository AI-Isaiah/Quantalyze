import { test, expect } from "@playwright/test";

/**
 * Admin Compute Jobs tab — Sprint 3 Commit 5.
 *
 * Skeletal smoke tests for the compute-jobs admin API.
 * Full UI tests require an authenticated admin session.
 */

test.describe("Admin Compute Jobs", () => {
  test("API returns 401 for unauthenticated request", async ({ request }) => {
    const res = await request.get("/api/admin/compute-jobs");
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    // Unauthenticated users get 401
    expect(res.status()).toBe(401);
  });

  test("API accepts filter query params without error shape", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/admin/compute-jobs?status=done&kind=sync_trades&limit=10&offset=0",
    );
    const contentType = res.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    // 401 for unauth, but at least it returns JSON, not a redirect
    expect([200, 401, 403]).toContain(res.status());
  });

  test.skip("admin sees Compute Jobs tab with rows", async () => {
    // Requires authenticated admin session with compute jobs in the DB.
    // Implement when test infrastructure supports admin login.
  });

  test.skip("non-admin gets 403 from compute-jobs API", async () => {
    // Requires authenticated non-admin session.
  });
});
