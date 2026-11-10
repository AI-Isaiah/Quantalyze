import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { stripCommentsPreserveLines } from "@/lib/source-scan";

/**
 * Phase 199 MANAGERHOME (ROUTE-01; CD-01, CD-03, R-01, R-02) - the go-home
 * call-site census.
 *
 * WHY THIS EXISTS. Every site that sends a signed-in user "home" used to name
 * the Discovery landing path as a literal, and a manager who clicked
 * "Go to Discovery" landed on a page that is not theirs. Phase 199 moved every
 * one of those sites to `ROLE_HOME_ROUTE` ("/home", the one server route that
 * reads the profile and redirects by role). A behavioural test per site proves
 * the site works today; none of them notices the NEXT site someone writes with
 * the old literal. This census is the edit-time fence for that: a new
 * hard-coded Discovery path used as home fails here, naming the file.
 *
 * THE TWO CONSTANTS MEAN TWO THINGS (R-01, R-02).
 *   - `ROLE_HOME_ROUTE` is the home. Home sites import it.
 *   - `DISCOVERY_LANDING_ROUTE` is where a link LABELLED Discovery goes. Only
 *     the three Discovery-labelled links import it. If a home site reached
 *     Discovery through the constant instead of the literal it would evade a
 *     literal-only census, so the census knows both names.
 *
 * The scan is comment-stripped (`stripCommentsPreserveLines`) because this
 * subject is prose: a docblock explaining why a site no longer links to
 * Discovery must not count as a site. String contents survive, so a manifest
 * note that quotes the path IS counted and sits on the allowlist.
 *
 * Every arm carries a vacuity fence (a hand-typed floor on what the scanner
 * found), because a tokenizer bug in the shared scanner fails silent.
 */

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

const DISCOVERY_PATH = "/discovery/crypto-sma";

function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      productionSources(abs, acc);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.d\.ts$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    acc.push(abs);
  }
  return acc;
}

/** Comment-stripped source of a repo-relative path. */
function code(rel: string): string {
  return stripCommentsPreserveLines(readFileSync(join(ROOT, rel), "utf8"), "ts");
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const ALL_SOURCES = productionSources(SRC).map((abs) => relative(ROOT, abs));
const STRIPPED = new Map<string, string>(ALL_SOURCES.map((rel) => [rel, code(rel)]));

/**
 * Navigation uses of the Discovery path: not "home", so each is allowed, with
 * a per-file count and the reason. A new file, or a higher count in a listed
 * file, fails the census; a listed file that no longer carries its count fails
 * it too, so the allowlist cannot rot into a list of exemptions that point
 * at nothing.
 *
 * The factsheet Discovery links (BackLink.tsx, origin.ts) and the Browse
 * Discovery link carry no literal: they read DISCOVERY_LANDING_ROUTE and are
 * pinned by DISCOVERY_CONSTANT_CONSUMERS below.
 */
const NAVIGATION_ALLOWLIST: Readonly<Record<string, { count: number; reason: string }>> = {
  "src/app/(dashboard)/compare/page.tsx": {
    count: 2,
    reason: "breadcrumb root, labelled Discovery (a breadcrumb names a place, not the user's home)",
  },
  "src/app/(dashboard)/decks/page.tsx": {
    count: 1,
    reason: "breadcrumb root, labelled Discovery",
  },
  "src/app/(dashboard)/discovery/[slug]/page.tsx": {
    count: 1,
    reason: "breadcrumb root, labelled Discovery",
  },
  "src/app/(dashboard)/discovery/layout.tsx": {
    count: 1,
    reason: "the Discovery login target: sign in, then return to Discovery",
  },
  "src/components/layout/Sidebar.tsx": {
    count: 1,
    reason: "the sidebar filler link, labelled Discovery",
  },
  "src/lib/routing/route-contract-manifest.ts": {
    count: 1,
    reason: "manifest note describing the hidden /decks redirect",
  },
  "src/lib/routing/default-route.ts": {
    count: 1,
    reason: "holds DISCOVERY_LANDING_ROUTE, the Discovery landing",
  },
};

/** Total literal occurrences the allowlist accounts for. */
const ALLOWLIST_TOTAL = 8;

/**
 * Error boundaries whose escape link leaves the failing surface (199 WR-01).
 * The role home redirects an allocator, a manager or an admin back into the
 * very /allocations, /strategies or /admin surface (or, for the root boundary,
 * the /home route itself) that threw, so these link to Discovery instead.
 * `strategies/error.tsx` is NOT here: Discovery is allocator-only, so a manager
 * sent there is bounced back to /strategies (WR-01-R2). See
 * ROLE_FREE_ESCAPE_BOUNDARIES.
 */
const ESCAPE_BOUNDARIES: readonly string[] = [
  "src/app/error.tsx",
  "src/app/(dashboard)/admin/error.tsx",
  "src/app/(dashboard)/allocations/error.tsx",
];

/**
 * Boundaries on a surface more than one role can reach, so their escape link
 * must open for every approved role: its target sits outside any segment whose
 * layout or page calls `requireRolePage` (WR-01-R2).
 */
const ROLE_FREE_ESCAPE_BOUNDARIES: Readonly<Record<string, string>> = {
  "src/app/(dashboard)/strategies/error.tsx": "/profile",
};

/**
 * The only production importers of DISCOVERY_LANDING_ROUTE (R-02): the three
 * Discovery-labelled links plus the escape boundaries. None of them names
 * ROLE_HOME_ROUTE.
 */
const DISCOVERY_CONSTANT_CONSUMERS: readonly string[] = [
  "src/app/browse/BrowseDiscoveryLink.tsx",
  "src/components/factsheet/BackLink.tsx",
  "src/lib/factsheet/origin.ts",
  ...ESCAPE_BOUNDARIES,
];

const DEFAULT_ROUTE_FILE = "src/lib/routing/default-route.ts";

const BOUNDARIES: readonly string[] = [
  "src/app/not-found.tsx",
  "src/app/(dashboard)/error.tsx",
  "src/app/(dashboard)/compare/error.tsx",
];

const ADMIN_GUARDS: readonly string[] = [
  "src/app/(dashboard)/admin/page.tsx",
  "src/app/(dashboard)/admin/compute-jobs/page.tsx",
  "src/app/(dashboard)/admin/csv-status/page.tsx",
  "src/app/(dashboard)/admin/deletion-requests/page.tsx",
  "src/app/(dashboard)/admin/for-quants-leads/page.tsx",
  "src/app/(dashboard)/admin/intros/page.tsx",
  "src/app/(dashboard)/admin/match/page.tsx",
  "src/app/(dashboard)/admin/match/[allocator_id]/page.tsx",
  "src/app/(dashboard)/admin/match/eval/page.tsx",
  "src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx",
  "src/app/(dashboard)/admin/usage/page.tsx",
  "src/app/(dashboard)/admin/users/page.tsx",
  "src/app/(dashboard)/admin/users/[id]/page.tsx",
];

/** Home sites that read ROLE_HOME_ROUTE. */
const HOME_SITES: readonly string[] = [
  "src/proxy.ts",
  "src/app/(marketing)/page.tsx",
  "src/components/marketing/MarketingHeaderActions.tsx",
  "src/components/auth/LoginForm.tsx",
  "src/components/auth/OnboardingWizard.tsx",
  ...BOUNDARIES,
  ...ADMIN_GUARDS,
];

/** Sites that decide the role at the server and so read roleHomeFor( instead. */
const ROLE_AWARE_SITES: readonly string[] = [
  "src/app/home/page.tsx",
  "src/app/(auth)/pending-approval/page.tsx",
];

describe("Phase 199 go-home call-site census (CD-01)", () => {
  it("vacuity fence: the scanner read the production tree and the default-route file", () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(500);
    expect(STRIPPED.get(DEFAULT_ROUTE_FILE)).toContain("export const ROLE_HOME_ROUTE");
    expect(STRIPPED.get(DEFAULT_ROUTE_FILE)).toContain("export const DISCOVERY_LANDING_ROUTE");
    // Comment stripping bit: the proxy docblock names the path, its code does not.
    expect(readFileSync(join(ROOT, "src/proxy.ts"), "utf8")).toContain(DISCOVERY_PATH);
    expect(STRIPPED.get("src/proxy.ts")).not.toContain(DISCOVERY_PATH);
  });

  it("every comment-stripped occurrence of the Discovery path is on NAVIGATION_ALLOWLIST with its count", () => {
    const found: Record<string, number> = {};
    for (const [rel, src] of STRIPPED) {
      const n = countOf(src, DISCOVERY_PATH);
      if (n > 0) found[rel] = n;
    }

    const unlisted = Object.keys(found)
      .filter((rel) => !(rel in NAVIGATION_ALLOWLIST))
      .map((rel) => `${rel} (${found[rel]}x)`);
    const wrongCount = Object.entries(NAVIGATION_ALLOWLIST)
      .filter(([rel, { count }]) => rel in found && found[rel] !== count)
      .map(([rel, { count }]) => `${rel}: allowlisted ${count}, found ${found[rel]}`);
    const missing = Object.keys(NAVIGATION_ALLOWLIST).filter((rel) => !(rel in found));

    expect({ unlisted, wrongCount, missing }).toEqual({
      unlisted: [],
      wrongCount: [],
      missing: [],
    });
  });

  it("the allowlist is count-pinned and every entry states a reason", () => {
    const total = Object.values(NAVIGATION_ALLOWLIST).reduce((a, e) => a + e.count, 0);
    expect(total).toBe(ALLOWLIST_TOTAL);
    for (const [rel, { reason }] of Object.entries(NAVIGATION_ALLOWLIST)) {
      expect(reason.length, rel).toBeGreaterThan(10);
    }
    expect(NAVIGATION_ALLOWLIST[DEFAULT_ROUTE_FILE].reason).toBe(
      "holds DISCOVERY_LANDING_ROUTE, the Discovery landing",
    );
  });

  it("positive arm: every home site reads ROLE_HOME_ROUTE", () => {
    expect(HOME_SITES.length).toBe(5 + 3 + 13);
    const without = HOME_SITES.filter((rel) => !code(rel).includes("ROLE_HOME_ROUTE"));
    expect(without).toEqual([]);
  });

  it("positive arm: /home and pending-approval decide by roleHomeFor(", () => {
    const without = ROLE_AWARE_SITES.filter((rel) => !code(rel).includes("roleHomeFor("));
    expect(without).toEqual([]);
  });

  it("no home site names the Discovery path or reaches Discovery through its constant", () => {
    const offenders = HOME_SITES.filter((rel) => {
      const src = code(rel);
      return src.includes(DISCOVERY_PATH) || src.includes("DISCOVERY_LANDING_ROUTE");
    });
    expect(offenders).toEqual([]);
  });
});

describe("Phase 199 Discovery-constant arm (R-01, R-02)", () => {
  it("the production files naming DISCOVERY_LANDING_ROUTE are exactly default-route.ts plus DISCOVERY_CONSTANT_CONSUMERS", () => {
    const naming = [...STRIPPED]
      .filter(([, src]) => src.includes("DISCOVERY_LANDING_ROUTE"))
      .map(([rel]) => rel)
      .sort();
    expect(DISCOVERY_CONSTANT_CONSUMERS.length).toBe(3 + 3);
    expect(naming).toEqual([DEFAULT_ROUTE_FILE, ...DISCOVERY_CONSTANT_CONSUMERS].sort());
  });

  it("a Discovery-constant consumer never also names ROLE_HOME_ROUTE", () => {
    const both = DISCOVERY_CONSTANT_CONSUMERS.filter((rel) => code(rel).includes("ROLE_HOME_ROUTE"));
    expect(both).toEqual([]);
  });
});

describe("Phase 199 role-free escape arm (WR-01-R2)", () => {
  // The escape href's route directory and its ancestors up to src/app, so a
  // guard in the target's own layout or page, or in a parent layout, is seen.
  function guardedBy(href: string): string[] {
    const segment = href.split("/")[1];
    const dir = ["src/app/(dashboard)", "src/app"]
      .map((base) => join(base, segment))
      .find((d) => existsSync(join(ROOT, d)));
    expect(dir, `no route directory for ${href}`).toBeDefined();
    const dirs: string[] = [];
    for (let d = dir!; d !== "src"; d = dirname(d)) dirs.push(d);
    return dirs
      .flatMap((d) => [join(d, "layout.tsx"), join(d, "page.tsx")])
      .filter((f) => existsSync(join(ROOT, f)) && code(f).includes("requireRolePage("));
  }

  it("each boundary links to its declared target, and that target is not behind requireRolePage", () => {
    expect(Object.keys(ROLE_FREE_ESCAPE_BOUNDARIES).length).toBeGreaterThan(0);
    for (const [rel, target] of Object.entries(ROLE_FREE_ESCAPE_BOUNDARIES)) {
      expect(code(rel), rel).toContain(`href="${target}"`);
      expect(guardedBy(target), `${rel} -> ${target}`).toEqual([]);
    }
  });

  it("the guard detector sees a role-guarded target (Discovery), so the arm above can fail", () => {
    expect(guardedBy(DISCOVERY_PATH)).toEqual(["src/app/(dashboard)/discovery/layout.tsx"]);
  });
});

describe("Phase 199 redirect-loop arm (T-199-28, the guard side of T-199-08)", () => {
  it("/home and every admin guard decide admin with isAdminUser, so a bounce never comes back", () => {
    const sites = ["src/app/home/page.tsx", ...ADMIN_GUARDS];
    const without = sites.filter((rel) => !/\bisAdminUser\(/.test(code(rel)));
    expect(without).toEqual([]);
  });

  it("every admin guard bounces a non-admin to ROLE_HOME_ROUTE, never to a literal", () => {
    const wrong = ADMIN_GUARDS.filter((rel) => !/redirect\(ROLE_HOME_ROUTE\)/.test(code(rel)));
    expect(wrong).toEqual([]);
  });
});
