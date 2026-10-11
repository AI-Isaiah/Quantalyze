import { test, expect } from "@playwright/test";

/**
 * Phase 170.3 OGPUBLIC (D-01, D-03) — signed-out share-card canary.
 *
 * A factsheet's share-preview image, `/api/og/factsheet/<id>`, is fetched by
 * Slack, LinkedIn and X WITHOUT cookies. The proxy's session gate runs before
 * the route handler, so until `"/api/og/factsheet"` joined `PUBLIC_ROUTES` every
 * such fetch got 307 to `/login` and no share ever showed a preview (the #512
 * class: a route that should be public landing on the auth form).
 *
 * UNSEEDED / PUBLIC spec — no seed env, no auth, no DB. It runs against the
 * placeholder-env build, where the route's Supabase read fails and the route
 * renders its fallback card. What it proves is narrow and is the point: the
 * proxy lets a cookie-less request through and the route answers with an image.
 * Whether an unpublished id leaks anything is proven by the route test
 * (`route.public-access.test.tsx`), not here.
 *
 * Test (b) is the control: a private API path must still 307 to `/login` in the
 * same run, so test (a) cannot pass merely because the request happened to
 * carry a session or because the proxy was off.
 */

// A fixed v4-shaped uuid. Nothing is looked up by it in the placeholder-env build.
const SHARE_CARD_ID = "22222222-2222-4222-8222-222222222222";

test.describe("signed-out share card (OGPUBLIC)", () => {
  test("GET /api/og/factsheet/<id> answers 200 image/png, never 307 to /login", async ({
    request,
  }) => {
    const res = await request.get(`/api/og/factsheet/${SHARE_CARD_ID}`, {
      maxRedirects: 0,
    });
    const location = res.headers()["location"] ?? "";

    expect(
      res.status(),
      `/api/og/factsheet/<id> returned HTTP ${res.status()} (location "${location}") — a public route landing on /login is the #512 class`,
    ).toBe(200);
    expect(
      location,
      `/api/og/factsheet/<id> carried a Location "${location}" — the share card must not redirect (the #512 class)`,
    ).toBe("");
    expect(
      res.headers()["content-type"] ?? "",
      "the share card must be served as image/png",
    ).toMatch(/^image\/png/);
    expect((await res.body()).length).toBeGreaterThan(0);
  });

  test("control: a private API path still 307s to /login", async ({ request }) => {
    const res = await request.get("/api/portfolios/list", { maxRedirects: 0 });
    expect(
      res.status(),
      `/api/portfolios/list returned HTTP ${res.status()} — expected 307 to /login; if it is 200 the proxy is not gating and test (a) proves nothing`,
    ).toBe(307);
    const location = res.headers()["location"] ?? "";
    expect(
      new URL(location, "http://localhost").pathname,
      `/api/portfolios/list Location was "${location}" — expected /login`,
    ).toBe("/login");
  });
});
