/**
 * Phase 195 TRIM / D-10 (ROADMAP SC-5, LEAN-03, LEAN-07) — ONE test lists every
 * route and control the phase removed, and goes RED if one renders or is linked
 * again.
 *
 * WHY ONE FILE. D-10 asks for a single place a reader can see the whole removal
 * set. The cases below are grouped by what they prove:
 *   a. routes on disk       — the portfolios tree, the portfolio-pdf API route
 *                             and the Tweaks files do not exist; the retired
 *                             report page exists and reads nothing (D-01/03/05)
 *   b. redirects            — next.config.ts and proxy.ts still carry the
 *                             positive controls that make an old link land
 *                             somewhere named (D-01/03/04)
 *   c. no in-app link       — no non-test source links to a retired route
 *   d. controls gone        — Tweaks, Dark mode, density, Decks nav, Add to
 *                             portfolio (D-02/04/05/06/07)
 *   e. render probes        — Sidebar and StrategyTable, rendered
 *   f. disclaimer once      — one block per public page (D-09)
 *
 * HOW IT SCANS. Every scan reads COMMENT-STRIPPED source
 * (`stripCommentsPreserveLines`), so prose naming a removed surface cannot trip
 * it and a real reinstatement cannot hide inside a comment. The population is
 * derived from disk on every run, with a vacuity floor. Redirect sources come
 * from the repo's own parsers (`parseRedirectSources`, `parsePublicRoutes`), not
 * a hand-rolled one.
 *
 * ALLOWLIST. The retired route literals legitimately remain in four files, and
 * only those: `src/proxy.ts` (PUBLIC_ROUTES), the route-contract manifest, the
 * retired page itself, and `next.config.ts` (outside `src`, so never scanned).
 * A RED guard is answered by removing the reinstated surface, never by editing
 * this list.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { render, screen } from "@testing-library/react";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import {
  parsePublicRoutes,
  parseRedirectSources,
} from "../../scripts/check-route-contract";
import { Sidebar, buildPrimaryMobileNav } from "@/components/layout/Sidebar";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: () => "/allocations",
}));

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

const REPO_ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");
const exists = (rel: string) => existsSync(join(REPO_ROOT, rel));
const code = (rel: string) => stripCommentsPreserveLines(read(rel), "ts");

/** Every failure ends with this; `d` is the decision id that removed the surface. */
const fix = (d: string) =>
  `This surface was removed in Phase 195 (${d}). Remove it again; do not widen the allowlist.`;

interface Hit {
  file: string;
  line: number;
  text: string;
}
const report = (hits: Hit[]) =>
  hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n");

// ---------------------------------------------------------------------------
// Population (derived from disk, never listed)
// ---------------------------------------------------------------------------

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      listSourceFiles(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
  return out;
}

/** The four files the retired literals legitimately remain in (see header). */
const LINK_ALLOWLIST = [
  "src/proxy.ts",
  "src/lib/routing/route-contract-manifest.ts",
  "src/app/portfolio-pdf/[id]/page.tsx",
  "next.config.ts",
] as const;

// ---------------------------------------------------------------------------
// Matchers (each has a self-test below)
// ---------------------------------------------------------------------------

/**
 * A string or template literal that OPENS with a retired route. The opener is a
 * quote, a backtick or the `}` closing a `${...}` interpolation, and the route
 * must end there (`(?![\w-])`), so `/portfolio-strategies`, `/portfolio-alerts`
 * and the `crypto-decks` / `tradfi-decks` category slugs never match.
 */
const RETIRED_LINKS: ReadonlyArray<{ re: RegExp; label: string; d: string }> = [
  { re: /(?:["'`]|\})\/portfolios(?![\w-])/, label: "/portfolios", d: "D-01" },
  { re: /(?:["'`]|\})\/portfolio-pdf(?![\w-])/, label: "/portfolio-pdf", d: "D-03" },
  { re: /(?:["'`]|\})\/api\/portfolio-pdf(?![\w-])/, label: "/api/portfolio-pdf", d: "D-03" },
  { re: /(?:["'`]|\})\/decks(?![\w-])/, label: "/decks", d: "D-04" },
];

function findRetiredLinks(source: string, file: string): Array<Hit & { d: string; label: string }> {
  const stripped = stripCommentsPreserveLines(source, "ts");
  const hits: Array<Hit & { d: string; label: string }> = [];
  stripped.split("\n").forEach((text, i) => {
    for (const r of RETIRED_LINKS) {
      if (r.re.test(text)) hits.push({ file, line: i + 1, text: text.trim(), d: r.d, label: r.label });
    }
  });
  return hits;
}

/** Lines of comment-stripped `source` containing any of `needles` (plain substrings, case-sensitive). */
function findNeedles(source: string, file: string, needles: readonly string[]): Hit[] {
  const stripped = stripCommentsPreserveLines(source, "ts");
  const hits: Hit[] = [];
  stripped.split("\n").forEach((text, i) => {
    if (needles.some((n) => text.includes(n))) hits.push({ file, line: i + 1, text: text.trim() });
  });
  return hits;
}

/** Lines of comment-stripped `source` matching `re`. Callers pass case-insensitive patterns (WR-04). */
function findPattern(source: string, file: string, re: RegExp): Hit[] {
  const stripped = stripCommentsPreserveLines(source, "ts");
  const hits: Hit[] = [];
  stripped.split("\n").forEach((text, i) => {
    if (re.test(text)) hits.push({ file, line: i + 1, text: text.trim() });
  });
  return hits;
}

/** `<Disclaimer` opening tags in comment-stripped source (not `<DisclaimerBanner`). */
function countDisclaimerTags(source: string): number {
  return (stripCommentsPreserveLines(source, "ts").match(/<Disclaimer\b/g) ?? []).length;
}

// Case-insensitive on purpose (WR-04): a reinstated control that is merely
// re-cased ("Dark Mode", "Add to Portfolio") must not slip past the guard.
const TWEAKS_RE = /toggle tweaks panel|design variations|allocations-tweaks-panel/i;
const DARK_MODE_RE = /\bdark[\s-]?(?:mode|theme)\b/i;
const ADD_TO_PORTFOLIO_RE = /\bAddToPortfolio\b|add to portfolio/i;
/** Any `dark` token left in factsheet-context.tsx code: a reinstated `get("dark")` / `dark:` read. */
const DARK_KEY_RE = /\bdark\b/i;

/**
 * Does comment-stripped next.config.ts carry `source -> destination` with this
 * `permanent` flag? `permanent` is pinned per rule (WR-04): D-04's /decks is a
 * 307 so removing the rule restores the page, and a browser-cached 308 would
 * defeat that.
 */
function hasRedirectRule(stripped: string, source: string, destination: string, permanent: boolean): boolean {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(
    `source:\\s*"${esc(source)}",\\s*destination:\\s*"${esc(destination)}",\\s*permanent:\\s*${permanent}\\b`,
  ).test(stripped);
}

// ---------------------------------------------------------------------------
// Fixtures for the StrategyTable probe (same shape StrategyTable.test.tsx uses)
// ---------------------------------------------------------------------------

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

function makeStrategy(id: string, name: string): StrategyWithAnalytics {
  const analytics: StrategyAnalytics = {
    id: "an-1",
    strategy_id: id,
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.42,
    cagr: 0.18,
    volatility: 0.22,
    sharpe: 1.5,
    sortino: 1.9,
    calmar: 1.1,
    max_drawdown: -0.12,
    max_drawdown_duration_days: 30,
    six_month_return: 0.21,
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
    metrics_json: null,
    returns_series: null,
    drawdown_series: null,
    monthly_returns: null,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: null,
    volume_metrics: null,
    exposure_metrics: null,
    data_quality_flags: null,
    trades_fetched_at: null,
  };
  return {
    id,
    name,
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    analytics,
  } as StrategyWithAnalytics;
}

// ===========================================================================
// SELF-TESTS — every matcher can fire, and ignores comments
// ===========================================================================

describe("trim-removed-surfaces — self-tests (the matchers can fail)", () => {
  it("link matcher fires on a synthetic retired portfolios href, a template href and each other retired route", () => {
    expect(findRetiredLinks('<a href="/portfolios/x" />\n', "s.tsx").map((h) => h.d)).toEqual(["D-01"]);
    expect(findRetiredLinks("const u = `${APP_URL}/portfolios`;\n", "s.tsx")).toHaveLength(1);
    expect(findRetiredLinks('<a href="/portfolio-pdf/x" />\n', "s.tsx").map((h) => h.d)).toEqual(["D-03"]);
    expect(findRetiredLinks('fetch("/api/portfolio-pdf/x")\n', "s.tsx").map((h) => h.d)).toEqual(["D-03"]);
    expect(findRetiredLinks('<a href="/decks" />\n', "s.tsx").map((h) => h.d)).toEqual(["D-04"]);
  });

  it("link matcher ignores the same text inside a line comment, a block comment and a JSX comment", () => {
    const src = [
      '// <a href="/portfolios/x" />',
      '/* <a href="/decks" /> */',
      'const x = <div>{/* <a href="/portfolio-pdf/1" /> */}</div>;',
    ].join("\n");
    expect(findRetiredLinks(src, "s.tsx")).toEqual([]);
  });

  it("link matcher does NOT flag the crypto-decks / tradfi-decks slugs, /portfolio-strategies or /portfolio-alerts", () => {
    const src = [
      'const a = "/discovery/crypto-decks";',
      'const b = "tradfi-decks";',
      'const c = "/api/portfolio-strategies";',
      'const d = "/api/portfolio-alerts";',
      'const e = "/portfolios-archive";',
    ].join("\n");
    expect(findRetiredLinks(src, "s.tsx")).toEqual([]);
  });

  it("Tweaks matcher fires on a synthetic Tweaks toggle (any casing) and ignores it in a comment", () => {
    expect(findPattern('<button aria-label="Toggle tweaks panel" />\n', "s.tsx", TWEAKS_RE)).toHaveLength(1);
    expect(findPattern('<p id="allocations-tweaks-panel" />\n', "s.tsx", TWEAKS_RE)).toHaveLength(1);
    expect(findPattern("<h2>Design variations · live</h2>\n", "s.tsx", TWEAKS_RE)).toHaveLength(1);
    // mixed-case positives (WR-04)
    expect(findPattern('<button aria-label="Toggle Tweaks Panel" />\n', "s.tsx", TWEAKS_RE)).toHaveLength(1);
    expect(findPattern("<h2>DESIGN Variations</h2>\n", "s.tsx", TWEAKS_RE)).toHaveLength(1);
    expect(findPattern('// aria-label="Toggle tweaks panel"\n', "s.tsx", TWEAKS_RE)).toEqual([]);
  });

  it("Dark mode matcher fires on mode/theme wordings in any casing and ignores a comment (WR-04)", () => {
    for (const label of ["Dark mode", "Dark Mode", "dark mode", "DARK-MODE", "Dark theme", "dark Theme"]) {
      expect(findPattern(`<label>${label}</label>\n`, "s.tsx", DARK_MODE_RE), label).toHaveLength(1);
    }
    expect(findPattern("// Dark mode was removed\n", "s.tsx", DARK_MODE_RE)).toEqual([]);
    expect(findPattern("<p>Darkness falls</p>\n", "s.tsx", DARK_MODE_RE)).toEqual([]);
  });

  it("dark-key matcher fires on a reinstated read of a `dark` key and ignores a comment (WR-04)", () => {
    expect(findPattern('const d = params.get("dark");\n', "s.tsx", DARK_KEY_RE)).toHaveLength(1);
    expect(findPattern("const x = { dark: true };\n", "s.tsx", DARK_KEY_RE)).toHaveLength(1);
    expect(findPattern('const d = params.get("DARK");\n', "s.tsx", DARK_KEY_RE)).toHaveLength(1);
    expect(findPattern('// params.get("dark") was removed\n', "s.tsx", DARK_KEY_RE)).toEqual([]);
    expect(findPattern('const k = params.get("cmp");\n', "s.tsx", DARK_KEY_RE)).toEqual([]);
  });

  it("AddToPortfolio matcher fires on an import, a mount and a re-cased label, and ignores a comment", () => {
    expect(
      findPattern('import { AddToPortfolio } from "@/components/portfolio/AddToPortfolio";\n', "s.tsx", ADD_TO_PORTFOLIO_RE),
    ).toHaveLength(1);
    expect(findPattern("<AddToPortfolio strategyId={id} />\n", "s.tsx", ADD_TO_PORTFOLIO_RE)).toHaveLength(1);
    expect(findPattern("<a>Add to portfolio</a>\n", "s.tsx", ADD_TO_PORTFOLIO_RE)).toHaveLength(1);
    // mixed-case positives (WR-04)
    expect(findPattern("<a>Add to Portfolio</a>\n", "s.tsx", ADD_TO_PORTFOLIO_RE)).toHaveLength(1);
    expect(findPattern("<a>ADD TO PORTFOLIO</a>\n", "s.tsx", ADD_TO_PORTFOLIO_RE)).toHaveLength(1);
    expect(findPattern("// <AddToPortfolio />\n", "s.tsx", ADD_TO_PORTFOLIO_RE)).toEqual([]);
  });

  it("redirect-rule matcher pins source, destination AND permanent (WR-04)", () => {
    const rule = (p: boolean) =>
      `{\n  source: "/decks",\n  destination: "/discovery/crypto-sma",\n  permanent: ${p},\n}`;
    expect(hasRedirectRule(rule(false), "/decks", "/discovery/crypto-sma", false)).toBe(true);
    expect(hasRedirectRule(rule(true), "/decks", "/discovery/crypto-sma", true)).toBe(true);
    // a flipped flag, a wrong destination and a wrong source each fail it
    expect(hasRedirectRule(rule(true), "/decks", "/discovery/crypto-sma", false)).toBe(false);
    expect(hasRedirectRule(rule(false), "/decks", "/discovery/crypto-sma", true)).toBe(false);
    expect(hasRedirectRule(rule(false), "/decks", "/elsewhere", false)).toBe(false);
    expect(hasRedirectRule(rule(false), "/other", "/discovery/crypto-sma", false)).toBe(false);
  });

  it("Disclaimer counter counts tags, ignores comments and a longer component name", () => {
    expect(countDisclaimerTags("<Disclaimer />\n<Disclaimer variant=\"footer\" />\n")).toBe(2);
    expect(countDisclaimerTags('// <Disclaimer />\n{/* <Disclaimer /> */}\n<DisclaimerBanner />\n')).toBe(0);
  });

  it("the allowlist is exactly the four named files and each exists", () => {
    expect([...LINK_ALLOWLIST].sort()).toEqual(
      [
        "next.config.ts",
        "src/app/portfolio-pdf/[id]/page.tsx",
        "src/lib/routing/route-contract-manifest.ts",
        "src/proxy.ts",
      ].sort(),
    );
    for (const f of LINK_ALLOWLIST) expect(exists(f), `${f} must exist`).toBe(true);
  });
});

// ===========================================================================
// a. Routes on disk
// ===========================================================================

describe("trim-removed-surfaces — a. routes on disk", () => {
  it("the /portfolios route tree does not exist (D-01)", () => {
    expect(
      exists("src/app/(dashboard)/portfolios"),
      `src/app/(dashboard)/portfolios exists again. ${fix("D-01")}`,
    ).toBe(false);
  });

  it("the /api/portfolio-pdf route does not exist (D-03)", () => {
    expect(
      exists("src/app/api/portfolio-pdf"),
      `src/app/api/portfolio-pdf exists again. ${fix("D-03")}`,
    ).toBe(false);
  });

  const RETIRED_PAGE = "src/app/portfolio-pdf/[id]/page.tsx";

  it("the retired-report page exists, is noindex and exports metadata (D-03)", () => {
    expect(exists(RETIRED_PAGE), `${RETIRED_PAGE} is gone: an old share link would 404. ${fix("D-03")}`).toBe(true);
    const src = code(RETIRED_PAGE);
    expect(src).toMatch(/export const metadata[\s\S]*robots:\s*["']noindex["']/);
  });

  it("the retired-report page reads nothing: no admin client, no render-token verifier, no search-param read (D-03)", () => {
    const hits = findNeedles(read(RETIRED_PAGE), RETIRED_PAGE, [
      "supabase/admin",
      "createAdminClient",
      "pdf-render-token",
      "verifyRenderToken",
      "renderToken",
      "searchParams",
      "useSearchParams",
    ]);
    expect(
      hits,
      `The retired page reads data again:\n${report(hits)}\n${fix("D-03")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// b. Redirects (positive controls)
// ===========================================================================

describe("trim-removed-surfaces — b. redirects", () => {
  const nextConfig = read("next.config.ts");
  const sources = parseRedirectSources(nextConfig);
  const stripped = stripCommentsPreserveLines(nextConfig, "ts");

  it("next.config.ts redirects() carries the three retired sources (D-01, D-03, D-04)", () => {
    for (const s of ["/portfolios/:path*", "/decks", "/api/portfolio-pdf/:id"]) {
      expect(sources, `redirects() lost "${s}". ${fix("D-01/D-03/D-04")}`).toContain(s);
    }
  });

  it("each retired source lands on its named destination with its pinned permanence (D-01, D-03, D-04)", () => {
    // /decks is a 307 (removing the rule restores the page); the other two are 308.
    const rules: Array<[string, string, boolean]> = [
      ["/portfolios/:path*", "/allocations", true],
      ["/decks", "/discovery/crypto-sma", false],
      ["/api/portfolio-pdf/:id", "/portfolio-pdf/:id", true],
    ];
    for (const [source, destination, permanent] of rules) {
      expect(
        hasRedirectRule(stripped, source, destination, permanent),
        `"${source}" no longer redirects to "${destination}" with permanent: ${permanent}. ${fix("D-01/D-03/D-04")}`,
      ).toBe(true);
    }
  });

  it("proxy.ts keeps /portfolio-pdf public so the retired page works without a session (D-03)", () => {
    expect(parsePublicRoutes(read("src/proxy.ts"))).toContain("/portfolio-pdf");
  });
});

// ===========================================================================
// c. No in-app link to a retired route
// ===========================================================================

describe("trim-removed-surfaces — c. no in-app link to a retired route", () => {
  const files = listSourceFiles(join(REPO_ROOT, "src"));

  it("scans a real population (an empty scan would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/components/layout/Sidebar.tsx");
    expect(files).toContain("src/lib/email.ts");
    expect(files.some(isTestPath)).toBe(false);
    for (const f of LINK_ALLOWLIST.filter((a) => a.startsWith("src/"))) expect(files).toContain(f);
  });

  it("positive control: the portfolio-alert email links My allocation (D-01)", () => {
    expect(code("src/lib/email.ts")).toContain("${APP_URL}/allocations");
  });

  it("no non-test source links to /portfolios, /portfolio-pdf, /api/portfolio-pdf or /decks outside the allowlist", () => {
    const hits = files
      .filter((f) => !(LINK_ALLOWLIST as readonly string[]).includes(f))
      .flatMap((f) => findRetiredLinks(read(f), f));
    expect(
      hits,
      `A source file links to a retired route:\n${hits
        .map((h) => `  ${h.file}:${h.line}  [${h.label}] ${h.text}`)
        .join("\n")}\n${fix([...new Set(hits.map((h) => h.d))].join("/") || "D-01")}`,
    ).toEqual([]);
  });
});

// ===========================================================================
// d. Controls gone
// ===========================================================================

describe("trim-removed-surfaces — d. controls gone", () => {
  const files = listSourceFiles(join(REPO_ROOT, "src"));

  it("the Tweaks panel and toggle files do not exist (D-05)", () => {
    for (const f of [
      "src/app/(dashboard)/allocations/components/Tweaks.tsx",
      "src/app/(dashboard)/allocations/components/TweaksToggle.tsx",
    ]) {
      expect(exists(f), `${f} exists again. ${fix("D-05")}`).toBe(false);
    }
  });

  it("no source carries the Tweaks toggle name, the 'Design variations' heading or the tweaks panel id (D-05)", () => {
    const hits = files.flatMap((f) => findPattern(read(f), f, TWEAKS_RE));
    expect(hits, `A Tweaks control is back:\n${report(hits)}\n${fix("D-05")}`).toEqual([]);
  });

  it("StrategyTable has no 'Table density' group and no data-density (D-07)", () => {
    const hits = findNeedles(read("src/components/strategy/StrategyTable.tsx"), "src/components/strategy/StrategyTable.tsx", [
      "Table density",
      "data-density",
    ]);
    expect(hits, `The density toggle is back:\n${report(hits)}\n${fix("D-07")}`).toEqual([]);
  });

  it("Sidebar has no Decks nav entry (D-04)", () => {
    const hits = findNeedles(read("src/components/layout/Sidebar.tsx"), "src/components/layout/Sidebar.tsx", [
      '"Decks"',
      "/decks",
    ]);
    expect(hits, `A Decks nav entry is back:\n${report(hits)}\n${fix("D-04")}`).toEqual([]);
  });

  it("no source offers a dark mode/theme item in any casing (D-06), and FactsheetView in particular", () => {
    const view = "src/app/factsheet/[id]/v2/FactsheetView.tsx";
    expect(exists(view)).toBe(true);
    const hits = files.flatMap((f) => findPattern(read(f), f, DARK_MODE_RE));
    expect(hits, `A Dark mode option is back:\n${report(hits)}\n${fix("D-06")}`).toEqual([]);
  });

  it("factsheet-context.tsx carries no `dark` token: no ?dark read, no stored dark value (D-06)", () => {
    const ctx = "src/app/factsheet/[id]/v2/factsheet-context.tsx";
    expect(exists(ctx)).toBe(true);
    const hits = findPattern(read(ctx), ctx, DARK_KEY_RE);
    expect(hits, `A dark key is read again:\n${report(hits)}\n${fix("D-06")}`).toEqual([]);
  });

  it("no source imports or mounts AddToPortfolio, and PortfolioOptimizer has no 'Add to portfolio' link (D-02)", () => {
    const optimizer = "src/components/portfolio/PortfolioOptimizer.tsx";
    expect(exists(optimizer)).toBe(true);
    const hits = files.flatMap((f) => findPattern(read(f), f, ADD_TO_PORTFOLIO_RE));
    expect(hits, `Add to portfolio is back:\n${report(hits)}\n${fix("D-02")}`).toEqual([]);
  });
});

// ===========================================================================
// e. Render probes
// ===========================================================================

describe("trim-removed-surfaces — e. render probes", () => {
  beforeEach(() => {
    installFetchMock();
    try {
      window.localStorage.clear();
    } catch {
      // non-fatal in jsdom configurations without clear()
    }
  });
  afterEach(() => {
    restoreFetchMock();
  });

  const roles: Array<[string, { isAllocator?: boolean; isManager?: boolean }]> = [
    ["allocator", { isAllocator: true }],
    ["manager", { isManager: true }],
    ["both", { isAllocator: true, isManager: true }],
  ];

  for (const [name, props] of roles) {
    for (const variant of ["desktop", "drawer"] as const) {
      it(`Sidebar (${name}, ${variant}) has no anchor to /decks and none under /portfolios (D-04, D-01)`, () => {
        const { container, unmount } = render(<Sidebar populatedSlugs={[]} variant={variant} {...props} />);
        const anchors = Array.from(container.querySelectorAll("a"));
        expect(anchors.length, "the Sidebar rendered no anchors: the probe is vacuous").toBeGreaterThan(0);
        const hrefs = anchors.map((a) => a.getAttribute("href") ?? "");
        expect(hrefs.filter((h) => h === "/decks" || h.startsWith("/decks/")), fix("D-04")).toEqual([]);
        expect(hrefs.filter((h) => h.startsWith("/portfolios")), fix("D-01")).toEqual([]);
        unmount();
      });
    }
  }

  it("the mobile bottom nav carries no Decks or portfolios entry for any role (D-04, D-01)", () => {
    for (const [, props] of [...roles, ["admin", { isAdmin: true } as { isAllocator?: boolean }] as const]) {
      const items = buildPrimaryMobileNav(props);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.label).not.toBe("Decks");
        const href = "href" in item && item.href ? item.href : "";
        expect(href.startsWith("/decks"), fix("D-04")).toBe(false);
        expect(href.startsWith("/portfolios"), fix("D-01")).toBe(false);
      }
    }
  });

  it("StrategyTable's default render has no group named 'Table density' (D-07)", () => {
    render(
      <StrategyTable
        strategies={[makeStrategy("11111111-0000-4000-8000-000000000001", "Alpha Stellar")]}
        categorySlug="crypto-sma"
      />,
    );
    expect(document.querySelector("[data-strategy-table]"), "the table did not render: the probe is vacuous").not.toBeNull();
    expect(screen.queryByRole("group", { name: "Table density" }), fix("D-07")).toBeNull();
  });
});

// ===========================================================================
// f. One disclaimer per page (D-09)
// ===========================================================================

describe("trim-removed-surfaces — f. disclaimer once", () => {
  const COUNTS: Array<[string, number]> = [
    ["src/app/browse/layout.tsx", 0],
    ["src/app/browse/page.tsx", 1],
    ["src/app/browse/[slug]/page.tsx", 1],
    ["src/app/browse/[slug]/[strategyId]/page.tsx", 1],
    ["src/app/factsheet/[id]/tearsheet/page.tsx", 0],
  ];

  for (const [file, expected] of COUNTS) {
    it(`${file} renders exactly ${expected} <Disclaimer (D-09)`, () => {
      expect(exists(file), `${file} must exist`).toBe(true);
      expect(
        countDisclaimerTags(read(file)),
        `${file} must carry ${expected} Disclaimer block(s). ${fix("D-09")}`,
      ).toBe(expected);
    });
  }

  it("the public strategy page's one block is the strategy-page variant (D-09)", () => {
    const src = code("src/app/browse/[slug]/[strategyId]/page.tsx");
    expect(src, fix("D-09")).toMatch(/<Disclaimer[^>]*variant="strategy-page"/);
  });

  it("positive control: Disclaimer.tsx still defines the footer, custody, strategy, factsheet and strategy-page variants", () => {
    const src = code("src/components/ui/Disclaimer.tsx");
    for (const v of ["footer", "custody", "strategy", "factsheet", "strategy-page"]) {
      expect(src, `Disclaimer.tsx lost the "${v}" variant`).toContain(`case "${v}":`);
    }
  });
});
