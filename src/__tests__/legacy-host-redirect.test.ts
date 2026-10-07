import { describe, it, expect } from "vitest";
import nextConfig from "../../next.config";

/**
 * DOMAINONE D-05: the old Vercel alias `quantalyze-rho.vercel.app` redirects
 * permanently to `https://quantalyze.xyz`, path and query kept, so there is
 * exactly one canonical address.
 *
 * This test proves the SHAPE of the rule in `next.config.ts`: the host value
 * is exact and escaped, the destination is a fixed origin, the move is
 * permanent, and cron requests are kept out. It does NOT prove that Vercel
 * serves a 308: the anchoring claim (RESEARCH A2) was measured on a local
 * server, and the live `curl -sI` host matrix in plan 13 is the real gate.
 *
 * Why the host value matters: a `has` entry of type `host` carries a
 * regex-like string. Unescaped dots would let a look-alike host
 * (`quantalyze-rhoXvercelXapp`) match and be sent to our canonical origin; a
 * loose rule would also redirect preview and per-deployment hosts
 * (`quantalyze-<hash>-<team>-projects.vercel.app`) that preview checks rely on.
 */

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: Array<{ type: string; key?: string; value?: string }>;
  missing?: Array<{ type: string; key?: string; value?: string }>;
};

async function hostRules(): Promise<RedirectRule[]> {
  const rules = (await nextConfig.redirects!()) as RedirectRule[];
  return rules.filter((r) => r.has?.some((h) => h.type === "host"));
}

async function theRule(): Promise<RedirectRule> {
  const rules = await hostRules();
  expect(rules).toHaveLength(1);
  return rules[0];
}

/** The host value, anchored the way the research measured Next to anchor it. */
async function hostMatcher(): Promise<RegExp> {
  const rule = await theRule();
  const entry = rule.has!.find((h) => h.type === "host")!;
  return new RegExp(`^(?:${entry.value})$`, "i");
}

describe("legacy host redirect rule (D-05)", () => {
  it("carries exactly one host rule", async () => {
    expect(await hostRules()).toHaveLength(1);
  });

  it("matches the rho host, case-insensitively", async () => {
    const re = await hostMatcher();
    expect(re.test("quantalyze-rho.vercel.app")).toBe(true);
    expect(re.test("QUANTALYZE-RHO.VERCEL.APP")).toBe(true);
  });

  it.each([
    ["suffix spoof", "quantalyze-rho.vercel.app.evil.example"],
    ["prefix spoof", "xquantalyze-rho.vercel.app"],
    ["unescaped-dot look-alike", "quantalyze-rhoXvercelXapp"],
    ["per-deployment host", "quantalyze-abc123xyz-team-projects.vercel.app"],
    ["preview branch host", "quantalyze-git-feat-x-team-projects.vercel.app"],
    ["the canonical host itself", "quantalyze.xyz"],
  ])("does not match a %s", async (_label, host) => {
    const re = await hostMatcher();
    expect(re.test(host)).toBe(false);
  });

  it("redirects any path to the same path on the canonical origin, permanently", async () => {
    const rule = await theRule();
    expect(rule.source).toBe("/:path*");
    expect(rule.destination).toBe("https://quantalyze.xyz/:path*");
    expect(rule.permanent).toBe(true);
  });

  it("keeps cron requests out of the rule (cron does not follow redirects)", async () => {
    const rule = await theRule();
    expect(rule.missing).toEqual([
      { type: "header", key: "x-vercel-cron-schedule" },
    ]);
  });

  it("leaves the /scenarios redirect unchanged", async () => {
    const rules = (await nextConfig.redirects!()) as RedirectRule[];
    expect(rules).toContainEqual({
      source: "/scenarios",
      destination: "/allocations?tab=scenario",
      permanent: true,
    });
  });
});
