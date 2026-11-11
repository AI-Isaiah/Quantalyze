import { test, expect } from "@playwright/test";

/**
 * API Key Connection Flow (Task 2.2)
 *
 * Tests the API key endpoint contract with Playwright's unauthenticated
 * `request` fixture. The strategy edit page's one-key panel tests (heading,
 * the Profile link, Resync, Change key…) moved to the seeded, blocking
 * `e2e/manager-keys.spec.ts` in Phase 200 gap closure: this file's only
 * Playwright list is the advisory `e2e` job, and those tests skipped on an env
 * var no workflow sets. Adding and deleting keys moved to the Profile tab in
 * Phase 200 (see the note where the panel describe was, below).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 158-05 (OPS-03 orphan repair, 2026-08-20): every mutating /api POST passes
 * through the CSRF origin gate (`assertSameOrigin`, src/lib/csrf.ts, added
 * 2026-05-17 — AFTER this spec was written) BEFORE auth. Playwright's `request`
 * fixture sends no Origin header by default, so these contract tests were
 * observing the CSRF 403 arm instead of the auth contract they assert. Sending
 * the app's own origin probes past the CSRF layer to the real contract.
 *
 * CI note for the batch wiring (plan 158-06): in a production-mode server
 * (`npm run start`) the localhost auto-allowlist in csrf.ts does NOT fire —
 * the job env needs `NEXT_PUBLIC_ALLOWED_ORIGINS: http://localhost:3000`
 * exactly as the seeded job already sets it (ci.yml `e2e-seeded` env, same
 * rationale comment there). Local `npm run dev` allowlists localhost natively.
 */
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

// ---------------------------------------------------------------------------
// API-level tests (no auth required — verify JSON contract)
// ---------------------------------------------------------------------------

test.describe("API Key Connection Flow", () => {
  test.describe("API endpoint contract", () => {
    test("validate-and-encrypt returns JSON, not HTML redirect", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        headers: { Origin: ORIGIN },
        data: { exchange: "binance", api_key: "test", api_secret: "test" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      expect(res.status()).not.toBe(307);

      // 158-REVIEW WR-07: without this line the case is vacuous for its own
      // stated purpose. A CSRF rejection ({ error: "Origin not allowed" }, 403,
      // JSON, not 307) satisfies every other assertion here — so if
      // NEXT_PUBLIC_ALLOWED_ORIGINS is dropped from the job env, or
      // PLAYWRIGHT_BASE_URL drifts from the origin the server is actually
      // served on, this test would keep passing while measuring the CSRF arm
      // instead of the auth contract. That is the EXACT failure mode the
      // docblock above says this spec was repaired for.
      expect(
        res.status(),
        "403 here means the Origin/allowlist wiring broke (CSRF rejected the request before auth), not that the auth contract changed — check NEXT_PUBLIC_ALLOWED_ORIGINS and PLAYWRIGHT_BASE_URL against the served origin",
      ).not.toBe(403);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    test("validate-and-encrypt returns 401 for unauthenticated request", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        headers: { Origin: ORIGIN },
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

    test("validate-and-encrypt rejects request with missing fields", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        headers: { Origin: ORIGIN },
        data: { exchange: "binance" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      // Either 401 (unauthenticated) or 400 (missing fields) — both valid
      expect([400, 401]).toContain(res.status());
    });
  });

  // -------------------------------------------------------------------------
  // The edit page's one-key panel tests moved to e2e/manager-keys.spec.ts
  // (Phase 200 gap closure: seeded, logged in, blocking in the e2e-seeded list).
  // Phase 200 D-07 / D-06: the edit page shows this strategy's ONE key
  // (`Resync`, `Change key…`) and links to the Profile API keys tab, the one
  // place keys are added, deleted and updated. The edit-page `Add Key`,
  // `Delete` and `Delete API Key` modal this spec used to drive are gone, and
  // so is the "No API keys connected" empty state. Their coverage now lives in:
  //   - AllocatorExchangeManager.test.tsx, the `manager-only parity: add`,
  //     `manager-only parity: delete` and `manager-only parity: update password`
  //     cases (the Profile tab's add / delete / update flows for a manager),
  //   - ApiKeyForm.test.tsx and ApiKeyForm.credential-input.test.tsx (the key
  //     form's exchange selector, passphrase field and required-field checks).
  // The credentialed submit and delete-modal e2e cases were dropped, not moved:
  // they need a live exchange key and a Profile-tab driver that this spec does
  // not have.
  // -------------------------------------------------------------------------
});
