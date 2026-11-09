import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import nextConfig from "../../next.config";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import { ROUTE_CONTRACT_MANIFEST } from "@/lib/routing/route-contract-manifest";

/**
 * Phase 196 ONESTRATEGYPAGE (D-03): a strategy has one page, the factsheet.
 * The four old detail routes (`/strategy/:id`, `/strategy/:id/v2`,
 * `/browse/:slug/:strategyId`, `/discovery/:slug/:strategyId`) are config-level
 * permanent redirects to `/factsheet/:id`, the browse and discovery ones
 * carrying their origin (`from`, `cat`) for the factsheet's back link (D-01).
 *
 * WHY each assertion matters:
 *  - destination + permanent: a bookmark, an email link or a shared URL to a
 *    strategy must reach the same strategy's factsheet, never a 404, a login
 *    wall or a different strategy (LEAN-02).
 *  - no `has`/`missing`: the rule must be unconditional. A cookie- or
 *    header-conditional rule would answer a signed-in and an anonymous visitor
 *    differently, and the redirect would then leak whether an id exists or is
 *    published (ROUTE-02). The destination, not the redirect, decides
 *    visibility; the redirect reads no database row.
 *  - manifest lockstep: `redirectFrom` is byte-equal to the config source, so
 *    `npm run check:route-contract` (#512) accepts the deleted routes.
 *
 * It proves the SHAPE of the config. It does NOT prove the live 308 status or
 * the destination-query interpolation: that is the first-hop canary in
 * `e2e/route-redirects.spec.ts` ("Phase 196 ONESTRATEGYPAGE").
 */

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: unknown[];
  missing?: unknown[];
};

const EXPECTED: ReadonlyArray<{ source: string; destination: string }> = [
  { source: "/strategy/:id", destination: "/factsheet/:id" },
  { source: "/strategy/:id/v2", destination: "/factsheet/:id" },
  {
    source: "/browse/:slug/:strategyId",
    destination: "/factsheet/:strategyId?from=browse&cat=:slug",
  },
  {
    source: "/discovery/:slug/:strategyId",
    destination: "/factsheet/:strategyId?from=discovery&cat=:slug",
  },
];

/**
 * Does comment-stripped next.config.ts carry `source -> destination` with this
 * `permanent` flag, keys in that order? Same helper shape as
 * `trim-removed-surfaces.test.tsx`.
 */
function hasRedirectRule(
  stripped: string,
  source: string,
  destination: string,
  permanent: boolean,
): boolean {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `source:\\s*"${esc(source)}",\\s*destination:\\s*"${esc(destination)}",\\s*permanent:\\s*${permanent}\\b`,
  ).test(stripped);
}

const strippedConfig = stripCommentsPreserveLines(
  readFileSync(join(process.cwd(), "next.config.ts"), "utf8"),
  "ts",
);

async function rules(): Promise<RedirectRule[]> {
  return (await nextConfig.redirects!()) as RedirectRule[];
}

describe("strategy detail routes redirect to the factsheet (Phase 196 D-03)", () => {
  for (const { source, destination } of EXPECTED) {
    it(`${source} -> ${destination}, permanent and unconditional`, async () => {
      const matches = (await rules()).filter((r) => r.source === source);
      expect(matches, `redirects() must carry exactly one "${source}" rule`).toHaveLength(1);
      const [rule] = matches;
      expect(rule.destination).toBe(destination);
      expect(rule.permanent).toBe(true);
      // Unconditional: no cookie/header/host/query condition (ROUTE-02).
      expect(rule.has, `"${source}" must not be conditional (has)`).toBeUndefined();
      expect(rule.missing, `"${source}" must not be conditional (missing)`).toBeUndefined();
    });

    it(`${source} is a live rule in the comment-stripped config source`, () => {
      expect(hasRedirectRule(strippedConfig, source, destination, true)).toBe(true);
    });

    it(`${source} has a manifest exception row whose redirectFrom is byte-equal`, () => {
      const rows = ROUTE_CONTRACT_MANIFEST.filter((e) => e.redirectFrom === source);
      expect(rows, `manifest must carry exactly one row with redirectFrom "${source}"`).toHaveLength(1);
      expect(rows[0].class).toBe("exception");
      expect(rows[0].route).toBe(source);
    });
  }

  it("the origin-carrying redirects pass the slug as cat and name their origin", async () => {
    const all = await rules();
    const discovery = all.find((r) => r.source === "/discovery/:slug/:strategyId")!;
    const browse = all.find((r) => r.source === "/browse/:slug/:strategyId")!;
    expect(discovery.destination).toContain("from=discovery");
    expect(discovery.destination).toContain("cat=:slug");
    expect(browse.destination).toContain("from=browse");
    expect(browse.destination).toContain("cat=:slug");
  });

  it("the hasRedirectRule helper itself fails a flipped flag and a wrong destination", () => {
    const ok = `source: "/a", destination: "/b", permanent: true`;
    expect(hasRedirectRule(ok, "/a", "/b", true)).toBe(true);
    expect(hasRedirectRule(ok, "/a", "/b", false)).toBe(false);
    expect(hasRedirectRule(ok, "/a", "/c", true)).toBe(false);
    expect(hasRedirectRule(ok, "/x", "/b", true)).toBe(false);
  });
});
