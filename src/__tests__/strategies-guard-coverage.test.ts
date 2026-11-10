import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { stripCommentsPreserveLines } from "@/lib/source-scan";

/**
 * Phase 199 plan 04 (D-01, CD-10, T-199-12) - every non-index strategies page
 * sits under a manager guard of its OWN.
 *
 * WHY: D-01 widens only the /strategies index, to every owner. Plan 199-09 did
 * that by removing the guard from the parent `strategies/layout.tsx` and from
 * the index page. A sub-route whose only guard was that parent is therefore
 * reachable by allocators. Each non-index page needs a layout between its own
 * directory and `strategies/` (the parent itself excluded) that calls
 * `requireRolePage(..., "manager")`. This test fails naming the page when one
 * does not. Its second block is the other half: the parent layout and the index
 * page must call NO requireRolePage, so a guard cannot creep back onto the
 * index and bounce allocators (T-199-29).
 *
 * The walk is pinned: it must find at least the three non-index pages measured
 * at HEAD (new, new/wizard, [id]/edit), otherwise it fails, so a broken walk or
 * a moved directory never passes vacuously. A NEW non-index page that appears
 * under strategies/ is covered automatically by the same rule.
 */

const STRATEGIES_DIR = join(process.cwd(), "src/app/(dashboard)/strategies");
const MIN_NON_INDEX_PAGES = 3;

function stripComments(src: string): string {
  return stripCommentsPreserveLines(src, "ts");
}

function walkPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walkPages(abs, acc);
    else if (entry.name === "page.tsx") acc.push(abs);
  }
  return acc;
}

/** Nearest layout.tsx from the page's directory up to, EXCLUDING, strategies/. */
function nearestOwnLayout(pagePath: string): string | null {
  let dir = dirname(pagePath);
  while (dir !== STRATEGIES_DIR && dir.startsWith(STRATEGIES_DIR)) {
    const candidate = join(dir, "layout.tsx");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

function guardsManager(layoutPath: string): boolean {
  const src = stripComments(readFileSync(layoutPath, "utf8"));
  return /requireRolePage\(\s*supabase\s*,\s*user\s*,\s*"manager"\s*\)/.test(src);
}

describe("strategies sub-routes carry their own manager guard (199-04)", () => {
  const pages = walkPages(STRATEGIES_DIR);
  const indexPage = join(STRATEGIES_DIR, "page.tsx");
  const nonIndex = pages.filter((p) => p !== indexPage);

  it("the walk finds the index and at least the three measured sub-route pages", () => {
    expect(pages).toContain(indexPage);
    expect(nonIndex.length).toBeGreaterThanOrEqual(MIN_NON_INDEX_PAGES);
  });

  it.each(nonIndex.map((p) => [relative(STRATEGIES_DIR, p), p]))(
    "%s has a layout of its own that calls requireRolePage with manager",
    (_label, pagePath) => {
      const layout = nearestOwnLayout(pagePath);
      expect(
        layout,
        `${relative(STRATEGIES_DIR, pagePath)} has no layout.tsx between its directory and strategies/; the parent guard alone is lost when the index widens`,
      ).not.toBeNull();
      expect(
        guardsManager(layout as string),
        `${relative(STRATEGIES_DIR, layout as string)} must call requireRolePage(supabase, user, "manager") outside comments`,
      ).toBe(true);
    },
  );
});

/** Any requireRolePage call, whatever its arguments, outside comments. */
function callsRequireRolePage(path: string): boolean {
  return /requireRolePage\s*\(/.test(stripComments(readFileSync(path, "utf8")));
}

describe("the strategies index admits every owner (199-09, D-01, T-199-29)", () => {
  const layout = join(STRATEGIES_DIR, "layout.tsx");
  const indexPage = join(STRATEGIES_DIR, "page.tsx");

  it("anti-vacuity: both files exist and the stripped source is not empty", () => {
    for (const f of [layout, indexPage]) {
      expect(existsSync(f), `${f} is missing`).toBe(true);
      expect(stripComments(readFileSync(f, "utf8")).length).toBeGreaterThan(200);
    }
  });

  it("strategies/layout.tsx calls no requireRolePage (the index must stay open to allocators)", () => {
    expect(
      callsRequireRolePage(layout),
      "strategies/layout.tsx guards the whole subtree again: allocators would be bounced from the index",
    ).toBe(false);
  });

  it("strategies/page.tsx calls no requireRolePage (it reads the role itself and builds role furniture)", () => {
    expect(
      callsRequireRolePage(indexPage),
      "strategies/page.tsx guards the index again: allocators would be bounced",
    ).toBe(false);
  });
});
