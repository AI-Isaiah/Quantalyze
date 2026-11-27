/**
 * Phase 244 DBACC-04 (SC-1) — owner reads of `strategies` must select `api_key_id`.
 *
 * WHY THIS EXISTS. `api-key-id-compile-guard.test.ts` proves a value typed
 * `PublicStrategy` cannot be handed to code that takes `Strategy`. It does NOT make an owner
 * read that LOST the key fail to compile: every owner read gets its row type from a cast
 * (`as unknown as Strategy`, `as unknown as OwnerListRow[]`, `as Strategy & {…}`) or an explicit
 * generic (`.single<Strategy & {…}>()`) over an unchecked select string. Change
 * `getMyStrategies`' select to `STRATEGY_PUBLIC_COLUMNS` and tsc stays green while every owner
 * row reads `api_key_id` as `undefined`, which the verified tick at
 * `src/components/strategy/StrategyTable.tsx` (`s.trust_tier === "api_verified" || s.api_key_id`)
 * reads as "no key". `src/lib/anon-strategies-projection.test.ts` does not cover this: it pins
 * the PUBLIC readers' projections only.
 *
 * WHAT IT PINS.
 *   1. OWNER_READ_SITES is the exact set of reads of `strategies` whose result is typed as an
 *      owner type by cast. Each site's `.select(` argument must start with `*` or name
 *      `api_key_id`. The `.select(` must be chained directly to the `.from("strategies")` and
 *      open with a quote, so a select built from a variable or helper FAILS instead of a later
 *      query's select being judged. An anchor / `.from` / `.select(` that cannot be found
 *      FAILS (a missing extraction never reads as a pass).
 *   2. CAST_CENSUS is the exact count of owner-type cast tokens per non-test source file. A new
 *      cast site, or a removed one, moves the census and reds until OWNER_READ_SITES and
 *      CAST_CENSUS are both updated in the same change.
 *
 * HONEST LIMIT. This reads SOURCE TEXT. It cannot see an owner read typed by an idiom the
 * cast regex does not name, a select assembled elsewhere and passed in, or a row that reaches
 * an owner type through a helper's parameter. It does not cover the shared table's own type:
 * `StrategyTable` / `StrategyGrid` type their row `PublicStrategy & { api_key_id?: string | null }`,
 * so the key is optional inside that component and a caller handing it a public projection still
 * compiles (booked in 244-REVIEW.md WR-01, not fixed here). Type safety of the owner reads stays
 * with the cast and this pin, not with tsc.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * One owner read per entry. `anchor` is a string unique in `file`; the read is the first
 * `.from("strategies")` after it, and the literal argument of the `.select(` chained to it is
 * the one checked.
 */
interface OwnerReadSite {
  name: string;
  file: string;
  anchor: string;
}

const OWNER_READ_SITES: OwnerReadSite[] = [
  {
    name: "getMyStrategies",
    file: "src/lib/queries.ts",
    anchor: "export async function getMyStrategies",
  },
  {
    name: "owner list (/strategies)",
    file: "src/app/(dashboard)/strategies/page.tsx",
    anchor: "const ownerList = supabase",
  },
  {
    name: "strategy edit page",
    file: "src/app/(dashboard)/strategies/[id]/edit/page.tsx",
    anchor: "const { data: strategy } = await supabase",
  },
  {
    name: "compare page",
    file: "src/app/(dashboard)/compare/page.tsx",
    anchor: "const [strategiesRes, holdingItemsRes]",
  },
];

/**
 * Owner-type cast tokens per file. `shapeRankingRows` (queries.ts) is where
 * `getMyStrategies`' rows are cast; the other files cast their own read in place.
 */
const CAST_CENSUS: Record<string, number> = {
  "src/lib/queries.ts": 2,
  "src/app/(dashboard)/strategies/page.tsx": 1,
  "src/app/(dashboard)/strategies/[id]/edit/page.tsx": 1,
  "src/app/(dashboard)/compare/page.tsx": 2,
};

const OWNER_TYPES = "Strategy|OwnerListRow|RankedStrategyRow";
// `as Strategy`, `as unknown as Strategy`, `as unknown as OwnerListRow[]`, `.single<Strategy…>`.
// `as Strategy["trust_tier"]` is an indexed-access cast of a field, not a row cast.
const CAST_RE = new RegExp(
  `\\bas (?:unknown as )?(?:${OWNER_TYPES})(?:\\[\\])?(?![\\w\\["'])|\\.single<\\s*(?:${OWNER_TYPES})\\b`,
  "g",
);

function mask(src: string): string {
  // Length-preserving: comments become spaces so indices and newlines stay put.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + " ".repeat(m.length - p1.length));
}

/**
 * The literal first argument of the `.select(` chained DIRECTLY to the `.from("strategies")`
 * that starts at `from`, or null. A bare identifier, a helper call or a gap between the two is
 * null, so a later query's select is never judged in its place.
 */
function selectArgAfter(masked: string, from: number): string | null {
  const chain = /^\.from\(\s*["']strategies["']\s*\)\s*\.select\(\s*(["'`])/.exec(masked.slice(from));
  if (!chain) return null;
  const open = from + chain[0].length;
  const close = masked.indexOf(chain[1], open);
  return close < 0 ? null : masked.slice(open, close);
}

function namesKey(arg: string): boolean {
  return /^\s*\*\s*(,|$)/.test(arg) || /\bapi_key_id\b/.test(arg);
}

function checkSite(site: OwnerReadSite): string | null {
  const text = mask(readFileSync(join(ROOT, site.file), "utf8"));
  const at = text.indexOf(site.anchor);
  if (at < 0) return `${site.name}: anchor not found in ${site.file}`;
  if (text.indexOf(site.anchor, at + 1) >= 0) return `${site.name}: anchor is not unique in ${site.file}`;
  const from = /\.from\(\s*["']strategies["']\s*\)/.exec(text.slice(at));
  if (!from) return `${site.name}: no .from("strategies") after the anchor in ${site.file}`;
  const arg = selectArgAfter(text, at + from.index);
  if (arg === null) return `${site.name}: no literal .select(...) chained to .from("strategies") in ${site.file}`;
  return namesKey(arg)
    ? null
    : `${site.name}: select does not start with * and does not name api_key_id (${site.file}): ${arg.slice(0, 120)}`;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
}

describe("owner reads of strategies keep api_key_id (DBACC-04 / SC-1)", () => {
  it.each(OWNER_READ_SITES.map((s) => [s.name, s] as const))(
    "%s selects * or names api_key_id",
    (_name, site) => {
      expect(checkSite(site)).toBeNull();
    },
  );

  it("the owner-type cast census is exactly the enumerated set", () => {
    const files: string[] = [];
    walk(SRC, files);
    const actual: Record<string, number> = {};
    for (const f of files) {
      const n = (mask(readFileSync(f, "utf8")).match(CAST_RE) ?? []).length;
      if (n > 0) actual[relative(ROOT, f)] = n;
    }
    expect(actual).toEqual(CAST_CENSUS);
  });

  it("every cast-census file has an owner read site", () => {
    expect(Object.keys(CAST_CENSUS).sort()).toEqual(
      [...new Set(OWNER_READ_SITES.map((s) => s.file))].sort(),
    );
  });
});
