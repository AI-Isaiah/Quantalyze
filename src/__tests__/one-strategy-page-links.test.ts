/**
 * Phase 196 ONESTRATEGYPAGE (D-01, D-03; LEAN-02, ROUTE-04) — a strategy has
 * one page, the factsheet, and every in-app link reaches it through ONE builder.
 *
 * WHY THIS GUARD EXISTS. The four old detail routes now 308 to the factsheet
 * (`next.config.ts`), so a link that still targets one keeps working — it just
 * costs a redirect hop and, for the discovery and browse routes, depends on the
 * redirect to carry the origin for the back link. Nothing else in CI notices a
 * stale link, because the redirect makes the click succeed. And a factsheet
 * link written as a raw template instead of `buildFactsheetHref` compiles,
 * renders and works, but carries no `?from=`, so the back link silently falls
 * back to nothing (D-01).
 *
 * THREE RULES, each with a red and a green self-test arm below:
 *   A. no comment-stripped, non-test source under `src` builds an href to a
 *      retired route (the old strategy route, a two-segment discovery/browse
 *      detail template, a factsheet `/v2` template, the grid's old
 *      `${basePath}/${categorySlug}` template).
 *   B. no comment-stripped, non-test source opens a template with the raw
 *      factsheet route outside `ALLOWED_RAW_FACTSHEET_HREFS`, a short named
 *      list whose entries must STILL contain the literal (a stale entry fails).
 *   C. every `next.config.ts` redirect that sends a visitor to the factsheet
 *      with a `from=` writes an origin `parseOrigin` reads and `backTargetFor`
 *      turns into the category surface's own list.
 *
 * NOT IN SCOPE, by construction: server-side URL builders that prefix the app
 * origin (`email.ts`, the pdf, og and cron routes) and `ShareableLink`, which
 * builds from `window.location.origin` so `from`/`cat` never ride into a shared
 * link. Their template opens with `${...}`, not with the route, so rule B's
 * pattern does not match them.
 *
 * A RED guard is answered by fixing the link, never by widening the allow-list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import nextConfig from "../../next.config";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
import { backTargetFor, parseOrigin } from "@/lib/factsheet/origin";

const REPO_ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

interface Hit {
  file: string;
  line: number;
  text: string;
  rule: string;
}
const report = (hits: Hit[]) =>
  hits.map((h) => `  ${h.file}:${h.line}  [${h.rule}] ${h.text}`).join("\n");

// ---------------------------------------------------------------------------
// Population (derived from disk, never listed)
// ---------------------------------------------------------------------------

function isExcludedPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) ||
    parts.includes("__tests__") ||
    parts.includes("test-fixtures")
  );
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
    if (!isExcludedPath(rel)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule A — retired-route hrefs
// ---------------------------------------------------------------------------

const RETIRED_ROUTE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  // The retired strategy route, three ways to write the href.
  { re: /`\/strategy\/\$\{/, label: "retired strategy route (template)" },
  { re: /["']\/strategy\/["']\s*\+/, label: "retired strategy route (concatenation)" },
  { re: /href=["']\/strategy\//, label: "retired strategy route (static href)" },
  // Two-segment discovery / browse detail routes (list pages are one segment).
  {
    re: /`\/(?:discovery|browse)\/\$\{[^}]*\}\/\$\{/,
    label: "retired discovery/browse detail route",
  },
  // A factsheet template (or static href) ending in /v2.
  { re: /`\/factsheet\/\$\{[^}]*\}\/v2/, label: "retired factsheet /v2 route (template)" },
  { re: /href=["']\/factsheet\/[^"']*\/v2/, label: "retired factsheet /v2 route (static href)" },
  // The grid's old `${basePath}/${categorySlug}/${id}` detail href.
  { re: /\$\{basePath\}\/\$\{/, label: "grid basePath/categorySlug detail template" },
];

/** Rule A on one file's source. Comment-stripped, so prose naming a route never trips it. */
export function scanRetiredRouteLinks(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  stripCommentsPreserveLines(source, "ts")
    .split("\n")
    .forEach((text, i) => {
      for (const p of RETIRED_ROUTE_PATTERNS) {
        if (p.re.test(text)) {
          hits.push({ file, line: i + 1, text: text.trim(), rule: `A ${p.label}` });
        }
      }
    });
  return hits;
}

// ---------------------------------------------------------------------------
// Rule B — one builder, plus a stale-checked allow-list
// ---------------------------------------------------------------------------

/** A template opening with the raw factsheet route, or a quoted prefix followed by `+`. */
const RAW_FACTSHEET_PATTERNS: readonly RegExp[] = [
  /`\/factsheet\/\$\{/,
  /["']\/factsheet\/["']\s*\+/,
];

/**
 * The only files allowed to hold a raw factsheet href template. Each entry is
 * asserted to still contain the literal, so an entry that outlives its literal
 * fails the guard instead of quietly widening it.
 */
export const ALLOWED_RAW_FACTSHEET_HREFS: ReadonlyArray<{ file: string; reason: string }> = [
  { file: "src/lib/factsheet/origin.ts", reason: "the builder itself" },
];

function hasRawFactsheetHref(source: string): boolean {
  const stripped = stripCommentsPreserveLines(source, "ts");
  return RAW_FACTSHEET_PATTERNS.some((re) => re.test(stripped));
}

/** Rule B on one file's source. */
export function scanRawFactsheetLinks(source: string, file: string): Hit[] {
  const hits: Hit[] = [];
  stripCommentsPreserveLines(source, "ts")
    .split("\n")
    .forEach((text, i) => {
      if (RAW_FACTSHEET_PATTERNS.some((re) => re.test(text))) {
        hits.push({ file, line: i + 1, text: text.trim(), rule: "B raw factsheet href" });
      }
    });
  return hits;
}

/** Allow-list entries whose file is gone or no longer holds the literal. */
export function staleAllowEntries(
  entries: ReadonlyArray<{ file: string }>,
  readSource: (file: string) => string | null,
): string[] {
  return entries
    .filter((e) => {
      const src = readSource(e.file);
      return src === null || !hasRawFactsheetHref(src);
    })
    .map((e) => e.file);
}

// ---------------------------------------------------------------------------
// Rule C — redirect destinations write an origin parseOrigin can read
// ---------------------------------------------------------------------------

type RedirectRule = { source: string; destination: string };

/**
 * For each redirect to `/factsheet/...` carrying `from=`: substitute `:slug`
 * with a real category slug and every other `:param` with a dummy id, then the
 * query must parse to an origin whose back target is the category list.
 * Returns the problems found (empty = fine) and how many rules were checked.
 */
export function checkRedirectOrigins(rules: readonly RedirectRule[]): {
  problems: string[];
  checked: number;
} {
  const problems: string[] = [];
  let checked = 0;
  for (const rule of rules) {
    if (!rule.destination.startsWith("/factsheet/") || !rule.destination.includes("from=")) continue;
    checked += 1;
    const concrete = rule.destination
      .replace(/:slug\b/g, "crypto-sma")
      .replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000001");
    const q = concrete.indexOf("?");
    if (q < 0) {
      problems.push(`${rule.source} -> ${rule.destination}: no query string`);
      continue;
    }
    const query = concrete.slice(q + 1);
    const origin = parseOrigin(new URLSearchParams(query));
    if (!origin) {
      problems.push(`${rule.source} -> ${rule.destination}: parseOrigin reads no origin from "${query}"`);
      continue;
    }
    const target = backTargetFor(origin);
    const ok = target?.href === "/discovery/crypto-sma" || target?.href === "/browse/crypto-sma";
    if (!ok) {
      problems.push(
        `${rule.source} -> ${rule.destination}: back target is ${target?.href ?? "null"}, expected the category list`,
      );
    }
  }
  return { problems, checked };
}

// ===========================================================================
// Self-tests — every rule can fire, and ignores comments
// ===========================================================================

describe("one-strategy-page-links — self-tests (the rules can fail)", () => {
  it("rule A fires on each way of writing a retired-route href", () => {
    const red = [
      "const h = `/strategy/${id}`;",
      'const h = "/strategy/" + id;',
      '<a href="/strategy/abc">x</a>',
      "const h = `/discovery/${slug}/${id}`;",
      "const h = `/browse/${slug}/${id}`;",
      "const h = `/factsheet/${id}/v2`;",
      '<a href="/factsheet/abc/v2">x</a>',
      "const h = `${basePath}/${categorySlug}/${id}`;",
    ];
    for (const line of red) {
      expect(scanRetiredRouteLinks(`${line}\n`, "s.tsx"), line).toHaveLength(1);
    }
  });

  it("rule A ignores the same text in a line, block and JSX comment, and does not flag list pages or the factsheet", () => {
    const green = [
      "// const h = `/strategy/${id}`;",
      "/* <a href=\"/strategy/abc\">x</a> */",
      "const x = <div>{/* `/discovery/${slug}/${id}` */}</div>;",
      "const list = `/discovery/${slug}`;",
      "const list2 = `/browse/${cat.slug}`;",
      'const strategies = "/strategies/abc";',
      "const f = `/factsheet/${id}`;",
    ].join("\n");
    expect(scanRetiredRouteLinks(green, "s.tsx")).toEqual([]);
  });

  it("rule B fires on a raw factsheet template and on a quoted prefix concatenation", () => {
    expect(scanRawFactsheetLinks("const h = `/factsheet/${id}`;\n", "s.tsx")).toHaveLength(1);
    expect(scanRawFactsheetLinks('const h = "/factsheet/" + id;\n', "s.tsx")).toHaveLength(1);
  });

  it("rule B does not flag a builder call, an origin-prefixed server URL, a comment or the API path", () => {
    const green = [
      'const h = buildFactsheetHref(id, { key: "allocations" });',
      "const url = `${window.location.origin}/factsheet/${id}`;",
      'const mail = `<a href="${APP_URL}/factsheet/${id}">x</a>`;',
      "// const h = `/factsheet/${id}`;",
      "const pdf = `/api/factsheet/${id}/pdf`;",
    ].join("\n");
    expect(scanRawFactsheetLinks(green, "s.tsx")).toEqual([]);
  });

  it("the stale-entry check reports an entry whose file lost the literal or is gone, and passes a live one", () => {
    const sources: Record<string, string> = {
      "live.ts": "const h = `/factsheet/${id}`;\n",
      "moved.ts": "const h = buildFactsheetHref(id);\n",
      "commented.ts": "// const h = `/factsheet/${id}`;\n",
    };
    const reader = (f: string) => sources[f] ?? null;
    expect(
      staleAllowEntries(
        [{ file: "live.ts" }, { file: "moved.ts" }, { file: "commented.ts" }, { file: "gone.ts" }],
        reader,
      ),
    ).toEqual(["moved.ts", "commented.ts", "gone.ts"]);
  });

  it("rule C passes a destination that carries a readable category origin", () => {
    const good = checkRedirectOrigins([
      { source: "/browse/:slug/:strategyId", destination: "/factsheet/:strategyId?from=browse&cat=:slug" },
      { source: "/discovery/:slug/:strategyId", destination: "/factsheet/:strategyId?from=discovery&cat=:slug" },
    ]);
    expect(good).toEqual({ problems: [], checked: 2 });
  });

  it("rule C fails an unknown `from`, a missing `cat` and a non-factsheet destination is skipped", () => {
    const bad = checkRedirectOrigins([
      { source: "/a/:slug/:id", destination: "/factsheet/:id?from=nowhere&cat=:slug" },
      { source: "/b/:slug/:id", destination: "/factsheet/:id?from=browse" },
      { source: "/c/:id", destination: "/elsewhere/:id?from=browse&cat=crypto-sma" },
    ]);
    expect(bad.checked).toBe(2);
    expect(bad.problems).toHaveLength(2);
    expect(bad.problems[0]).toContain("/a/:slug/:id");
    expect(bad.problems[1]).toContain("/b/:slug/:id");
  });
});

// ===========================================================================
// The corpus
// ===========================================================================

describe("one-strategy-page-links — the corpus", () => {
  const files = listSourceFiles(join(REPO_ROOT, "src"));

  it("scans a real population (an empty scan would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("src/lib/factsheet/origin.ts");
    expect(files).toContain("src/components/strategy/StrategyTable.tsx");
    expect(files.some(isExcludedPath)).toBe(false);
  });

  it("rule A: no source links to a retired strategy, discovery/browse detail or factsheet /v2 route", () => {
    const hits = files.flatMap((f) => scanRetiredRouteLinks(read(f), f));
    expect(
      hits,
      `An in-app link targets a retired route (D-03):\n${report(hits)}\nBuild it with buildFactsheetHref from @/lib/factsheet/origin.`,
    ).toEqual([]);
  });

  it("rule B: every factsheet link goes through buildFactsheetHref outside the stale-checked allow-list", () => {
    const allowed = new Set(ALLOWED_RAW_FACTSHEET_HREFS.map((e) => e.file));
    const hits = files.filter((f) => !allowed.has(f)).flatMap((f) => scanRawFactsheetLinks(read(f), f));
    expect(
      hits,
      `A factsheet link bypasses the builder, so it carries no ?from= (D-01):\n${report(hits)}\nUse buildFactsheetHref(id, { key }) from @/lib/factsheet/origin; do not widen the allow-list.`,
    ).toEqual([]);
  });

  it("rule B: the allow-list is exactly the builder, and its entry is not stale", () => {
    expect(ALLOWED_RAW_FACTSHEET_HREFS.map((e) => e.file).sort()).toEqual([
      "src/lib/factsheet/origin.ts",
    ]);
    const stale = staleAllowEntries(ALLOWED_RAW_FACTSHEET_HREFS, (f) =>
      existsSync(join(REPO_ROOT, f)) ? read(f) : null,
    );
    expect(
      stale,
      `ALLOWED_RAW_FACTSHEET_HREFS entries no longer hold a raw factsheet template; delete them:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("rule C: every redirect into the factsheet with a `from=` writes an origin parseOrigin reads", async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    const { problems, checked } = checkRedirectOrigins(rules as RedirectRule[]);
    // The browse and discovery rules; fewer means the population drifted away.
    expect(checked, "the redirect population shrank: the check is vacuous").toBeGreaterThanOrEqual(2);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
