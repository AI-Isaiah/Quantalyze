import { test, expect } from "@playwright/test";

/**
 * Phase 51-05 / NAV-01 — selective-route-move redirect canary.
 *
 * Phase 51 takes exactly ONE route move: the legacy Strategy-Sandbox surface
 * `/scenarios` is consolidated into the unified composer at
 * `/allocations?tab=scenario`. 51-05 formalized the former in-page `redirect()`
 * stub into a config-level `redirects({ permanent: true })` 308 in
 * `next.config.ts` (the stub `page.tsx` is retired; the manifest carries
 * `redirectFrom: "/scenarios"` so the route-contract guard's Rule 3 enforces
 * the lockstep at build time). This spec proves the move at RUNTIME.
 *
 * The HARD-RULE for every move (51-CONTEXT constraint (c)): a canary proving
 * the OLD link resolves toward the new path and NOT to a silent 307→login (the
 * #512 regression class). The subtlety here vs a public-route move: the
 * destination `/allocations` is an AUTHED dashboard route. So an anon visitor
 * who FOLLOWS the chain ends at `/login` — but that is the PROXY auth-gating
 * `/allocations` (correct authed behavior), NOT the move redirect bouncing to
 * login. The #512 bug is a route that SHOULD be public landing on /login; this
 * is an authed destination correctly gating an anon visitor.
 *
 * Therefore the canary asserts the FIRST hop — the move redirect itself — with
 * the chain NOT followed (`maxRedirects: 0`):
 *   1. GET /scenarios returns a 308 (the permanent, method-preserving move).
 *   2. its `Location` points at /allocations?tab=scenario (the composer), and
 *      NEVER at /login — the move lands on the canonical destination, not the
 *      auth form. This is the precise #512 assertion for an authed-destination
 *      move: the redirect MAP is correct; the destination's OWN auth is a
 *      separate, correct hop the proxy owns.
 *
 * UNSEEDED / PUBLIC spec — no auth, no seed env, no DB. Runs against the
 * placeholder-env build and carries NO seed-env self-skip guard at all
 * (mirrors marketing-shell.spec.ts / reflow-sweep.spec.ts). FLOW-01 single
 * wiring point: the ci.yml UNSEEDED Playwright list is the ONE place this runs;
 * the deliberate ABSENCE of any seed-env/auth dependency means there is no
 * second gated list it could be silently dropped from. The seed-env token, the
 * QA-demo account, and the session-injection helper are intentionally absent
 * from this file so the "no seed / no auth / public" property is provable by a
 * plain grep of those identifiers returning zero hits.
 */

test.describe("selective route moves — anon redirect canary (NAV-01)", () => {
  test("/scenarios 308-redirects toward the composer (never 307→login)", async ({
    request,
  }) => {
    // First hop only — do NOT follow the chain. Following it would land on
    // /login (the proxy auth-gating the authed /allocations destination for an
    // anon visitor), which is correct behavior but NOT what this canary checks.
    // We assert the MOVE redirect's own status + Location.
    const res = await request.get("/scenarios", { maxRedirects: 0 });

    // (1) the move is a permanent, method-preserving 308 (permanent: true).
    expect(
      res.status(),
      `/scenarios returned HTTP ${res.status()} — expected a 308 permanent redirect (next.config.ts redirects())`,
    ).toBe(308);

    // (2) the redirect lands on the composer deep-link, NEVER on /login.
    const location = res.headers()["location"] ?? "";
    expect(
      location,
      `/scenarios 308 Location was "${location}" — expected /allocations?tab=scenario (the composer)`,
    ).toContain("/allocations");
    expect(
      location,
      `/scenarios 308 Location was "${location}" — expected the scenario tab on the composer`,
    ).toContain("tab=scenario");
    // The #512 assertion: the MOVE must not bounce the old link to the auth form.
    expect(
      location,
      `/scenarios 308 Location was "${location}" — the move must land on the composer, NOT /login (the #512 regression class)`,
    ).not.toContain("/login");
  });

  // Phase 199 MANAGERHOME (D-01, CD-06) - `/my-strategies` is deleted and 308s to the
  // one strategies list. First hop only, chain not followed: following it would end
  // at /login for an anonymous visitor (the proxy gating /strategies), which is the
  // destination's own auth and not this move. The query rides along, and the old
  // link must never be answered by the auth form (the #512 class).
  test("/my-strategies?x=1 308-redirects to /strategies and keeps the query (never 307→login)", async ({
    request,
  }) => {
    const res = await request.get("/my-strategies?x=1", { maxRedirects: 0 });

    expect(
      res.status(),
      `/my-strategies?x=1 returned HTTP ${res.status()} - expected a 308 permanent redirect (next.config.ts redirects())`,
    ).toBe(308);

    const location = res.headers()["location"] ?? "";
    expect(
      location,
      `/my-strategies?x=1 308 Location was "${location}" - expected /strategies`,
    ).toContain("/strategies");
    expect(
      location,
      `/my-strategies?x=1 308 Location was "${location}" - the query string was dropped`,
    ).toContain("x=1");
    expect(
      location,
      `/my-strategies?x=1 308 Location was "${location}" - the move must land on /strategies, NOT /login (the #512 regression class)`,
    ).not.toContain("/login");
  });

  // Phase 195 TRIM (D-03), 2026-11-07 — the portfolio report is retired. An old
  // link by EITHER URL must end on the named retired page, never a login wall,
  // a 404, or a JSON/PDF error.
  test("/api/portfolio-pdf/:id 308-redirects to the retired page (never 307→login)", async ({
    request,
  }) => {
    const res = await request.get("/api/portfolio-pdf/x", { maxRedirects: 0 });

    expect(
      res.status(),
      `/api/portfolio-pdf/x returned HTTP ${res.status()} — expected a 308 permanent redirect (next.config.ts redirects())`,
    ).toBe(308);

    const location = res.headers()["location"] ?? "";
    expect(
      location,
      `/api/portfolio-pdf/x 308 Location was "${location}" — expected /portfolio-pdf/x (the retired-report page)`,
    ).toContain("/portfolio-pdf/x");
    expect(
      location,
      `/api/portfolio-pdf/x 308 Location was "${location}" — an old report link must not land on /login (the #512 regression class)`,
    ).not.toContain("/login");
  });

  test("/portfolio-pdf/:id renders the retired page to an anonymous visitor", async ({
    request,
  }) => {
    // No auth, no render token, redirects off: the page itself must answer 200.
    const res = await request.get(
      "/portfolio-pdf/00000000-0000-0000-0000-000000000000",
      { maxRedirects: 0 },
    );

    expect(
      res.status(),
      `/portfolio-pdf/<id> returned HTTP ${res.status()} — expected 200 (public retired-report page, no login wall, no 404)`,
    ).toBe(200);
    expect(await res.text()).toContain("This allocation report has been retired");
  });

  // Phase 195 TRIM (D-04), 2026-11-07 — Decks is hidden until it works. The
  // redirect is temporary (307) so removing the rule restores the page, and it
  // lands on discovery, never the auth form.
  test("/decks 307-redirects to discovery (never 307→login)", async ({
    request,
  }) => {
    const res = await request.get("/decks", { maxRedirects: 0 });

    expect(
      res.status(),
      `/decks returned HTTP ${res.status()} — expected a 307 temporary redirect (next.config.ts redirects())`,
    ).toBe(307);

    const location = res.headers()["location"] ?? "";
    expect(
      location,
      `/decks 307 Location was "${location}" — expected /discovery/crypto-sma`,
    ).toContain("/discovery/crypto-sma");
    expect(
      location,
      `/decks 307 Location was "${location}" — a hidden surface must not bounce to /login (the #512 regression class)`,
    ).not.toContain("/login");
  });

  // Phase 195 TRIM (D-01), 2026-11-07 — the portfolios surface is retired.
  // Every sub-route, including the bare path (assumption A3: `:path*` matches
  // it) and the dead strategies/<id> target, answers one 308 to My allocation,
  // never the login form. Query strings are forwarded by Next (accepted).
  for (const path of [
    "/portfolios",
    "/portfolios/x",
    "/portfolios/x/manage?add=y",
    "/portfolios/x/documents",
    "/portfolios/x/strategies/y",
  ]) {
    test(`${path} 308-redirects to /allocations (never 307→login)`, async ({
      request,
    }) => {
      const res = await request.get(path, { maxRedirects: 0 });

      expect(
        res.status(),
        `${path} returned HTTP ${res.status()} — expected a 308 permanent redirect (next.config.ts redirects())`,
      ).toBe(308);

      const location = res.headers()["location"] ?? "";
      expect(
        location,
        `${path} 308 Location was "${location}" — expected /allocations`,
      ).toContain("/allocations");
      expect(
        location,
        `${path} 308 Location was "${location}" — a retired surface must not bounce to /login (the #512 regression class)`,
      ).not.toContain("/login");
    });
  }
});

// Phase 196 ONESTRATEGYPAGE (D-03), 2026-11-08 — a strategy has one page, the
// factsheet. Every old detail route answers one 308 on the FIRST hop (chain not
// followed), signed in or not, to /factsheet/<id>, never the login form. The
// discovery and browse redirects carry their origin (from, cat) for the
// factsheet's back link (D-01); the request's own query string is passed
// through. The redirect reads no database row: an unpublished or missing id is
// answered by the factsheet's own not-found, not by this hop.
test.describe("Phase 196 ONESTRATEGYPAGE (D-03) — retired strategy detail routes", () => {
  test("/discovery/crypto-sma/x?share=1 308-redirects to the factsheet with its origin and query", async ({
    request,
  }) => {
    const res = await request.get("/discovery/crypto-sma/x?share=1", {
      maxRedirects: 0,
    });

    expect(
      res.status(),
      `/discovery/crypto-sma/x returned HTTP ${res.status()} — expected a 308 permanent redirect (next.config.ts redirects())`,
    ).toBe(308);

    const location = res.headers()["location"] ?? "";
    expect(
      location,
      `308 Location was "${location}" — expected /factsheet/x`,
    ).toContain("/factsheet/x");
    expect(location, `Location "${location}" lost the origin`).toContain(
      "from=discovery",
    );
    expect(location, `Location "${location}" lost the category`).toContain(
      "cat=crypto-sma",
    );
    expect(
      location,
      `Location "${location}" dropped the request's own query (share=1)`,
    ).toContain("share=1");
    expect(
      location,
      `Location "${location}" — an old shared link must not land on /login (the #512 regression class)`,
    ).not.toContain("/login");
  });

  test("/browse/crypto-sma/x 308-redirects to the factsheet with its origin", async ({
    request,
  }) => {
    const res = await request.get("/browse/crypto-sma/x", { maxRedirects: 0 });

    expect(
      res.status(),
      `/browse/crypto-sma/x returned HTTP ${res.status()} — expected a 308 permanent redirect`,
    ).toBe(308);

    const location = res.headers()["location"] ?? "";
    expect(location, `308 Location was "${location}"`).toContain("/factsheet/x");
    expect(location, `Location "${location}" lost the origin`).toContain(
      "from=browse",
    );
    expect(location, `Location "${location}" lost the category`).toContain(
      "cat=crypto-sma",
    );
    expect(location, `Location "${location}" must not be /login`).not.toContain(
      "/login",
    );
  });

  for (const path of ["/strategy/x", "/strategy/x/v2"]) {
    test(`${path} 308-redirects to /factsheet/x (never 307→login)`, async ({
      request,
    }) => {
      const res = await request.get(path, { maxRedirects: 0 });

      expect(
        res.status(),
        `${path} returned HTTP ${res.status()} — expected a 308 permanent redirect`,
      ).toBe(308);

      const location = res.headers()["location"] ?? "";
      expect(location, `${path} 308 Location was "${location}"`).toContain(
        "/factsheet/x",
      );
      expect(
        location,
        `${path} 308 Location was "${location}" — must not land on /login`,
      ).not.toContain("/login");
    });
  }
});
