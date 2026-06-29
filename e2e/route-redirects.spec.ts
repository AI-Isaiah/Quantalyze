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
});
