/**
 * Phase 170.6.1.1 ANONKEYID (D-02, O-1) - static census pin for anonymous `strategies` readers.
 *
 * WHY THIS EXISTS. Phase 170.6.1.1 revokes `anon`'s table-level SELECT on `public.strategies`
 * and re-grants it column by column, WITHOUT `api_key_id`. After that, an anonymous query that
 * names `api_key_id`, or selects `*` (which PostgREST expands to every column, `api_key_id`
 * included), fails with 42501 and the page behind it is an outage. PR-A narrowed every anonymous
 * reader to `STRATEGY_PUBLIC_COLUMNS` (or `"id"`) ahead of the revoke; this file keeps it that
 * way, so the NEXT anonymous wildcard reader fails a unit test before it ships, not in production.
 *
 * WHAT IT PINS.
 *   1. `getStrategiesByCategory`, `getPublicStrategyDetail` and `getFactsheetDetail`
 *      (`src/lib/queries.ts`): the `.select(` that follows the function's `.from("strategies")`
 *      contains `STRATEGY_PUBLIC_COLUMNS`, is not a wildcard, and does not name `api_key_id`.
 *      A function, `.from("strategies")` or `.select(` that cannot be found FAILS (a missing
 *      extraction must never read as a pass).
 *   2. `STRATEGY_PUBLIC_COLUMNS_ARR` holds 31 unique entries and not `api_key_id`.
 *   3. The landing page's strategies count (`src/app/(marketing)/page.tsx`) selects `"id"`.
 *      A HEAD count expands a wildcard against the column grants too (measured on the simulated
 *      revoke: HTTP 401), so a `"*"` count is the same outage.
 *   4. Every non-test `.ts`/`.tsx` file under the anonymous route directories: any
 *      `from("strategies")` whose following `.select(` argument starts with `*`, has a top-level
 *      `*` item, or contains `api_key_id`, and is not in ANON_ROUTE_EXEMPTIONS, fails.
 *
 * HONEST SCOPE (orchestrator I2). This pin reads SOURCE TEXT. It cannot see a select whose
 * argument is built from a variable or a helper (a column list assembled elsewhere and passed in:
 * `.select(cols)`), a reader outside the directories listed below, a `from` call whose table name
 * is itself a variable, or a PostgREST embed of `strategies` from another table. Comments inside
 * the select argument are skipped, but a regex literal containing a quote could confuse the
 * argument scanner. The live probe `src/lib/anon-strategies-live-probe.test.ts` (real anon
 * client against the local lane) is the behavioural backstop for everything this file cannot see.
 *
 * Idiom: the source-walker of `src/lib/sec-005-api-keys-projection.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, lstatSync, realpathSync } from "fs";
import { join, relative, resolve } from "path";
import { STRATEGY_PUBLIC_COLUMNS_ARR } from "./constants";

const REPO_ROOT = resolve(__dirname, "..", "..");
const QUERIES_PATH = join(REPO_ROOT, "src", "lib", "queries.ts");
const LANDING_PATH = join(REPO_ROOT, "src", "app", "(marketing)", "page.tsx");

/** The anonymous route directories (D-02): public pages, share links, OG and factsheet routes. */
const ANON_ROUTE_DIRS = [
  "src/app/browse",
  "src/app/strategy",
  "src/app/factsheet",
  "src/app/factsheet-share",
  "src/app/scenario-share",
  "src/app/portfolio-pdf",
  "src/app/(marketing)",
  "src/app/api/og",
  "src/app/api/factsheet",
];

/**
 * Census entries that name `api_key_id` or read `strategies` in these directories but are NOT an
 * anonymous read. Keyed by repo-relative path; `reason` says why, and `hits` is the EXACT number
 * of flagged selects in that file, so a second wildcard added to an exempt file is still caught.
 */
const ANON_ROUTE_EXEMPTIONS: Record<string, { hits: number; reason: string }> = {
  "src/app/factsheet/[id]/tearsheet/page.tsx": {
    hits: 1,
    reason:
      "readTradeFacts embeds api_keys!strategies_api_key_id_fkey through createAdminClient(): a service-role read that bypasses column grants, never the anon client.",
  },
  "src/app/factsheet/[id]/v2/page.tsx": {
    hits: 1,
    reason:
      "Lane B (own-draft probe) runs after auth.getUser() returned a user, on the authenticated session client, which keeps SELECT on api_key_id.",
  },
};

// ---------------------------------------------------------------- source scanning helpers

function walk(dir: string, seen: Set<string> = new Set()): string[] {
  let canonical = dir;
  try {
    canonical = realpathSync(dir);
  } catch {
    /* keep dir */
  }
  if (seen.has(canonical)) return [];
  seen.add(canonical);
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === ".next" ||
      entry === "dist" ||
      entry.endsWith(".test.ts") ||
      entry.endsWith(".test.tsx")
    ) {
      continue;
    }
    const full = join(dir, entry);
    let s;
    try {
      s = lstatSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory() || s.isSymbolicLink()) {
      out.push(...walk(full, seen));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const FROM_STRATEGIES = /\.from\s*\(\s*["'`]strategies["'`]\s*\)/g;

/**
 * Returns the text between the parentheses of the `.select(` call that follows `fromEnd`, with
 * comments removed and strings kept verbatim, or null when no `.select(` appears before the next
 * `.from(` (that chain is not a select). The scanner tracks string, template-literal and comment
 * state so a `)` or an apostrophe inside either cannot end the argument early.
 */
function selectArgAfter(src: string, fromEnd: number): string | null {
  const rest = src.slice(fromEnd);
  const nextFrom = rest.search(/\.from\s*\(/);
  const window = nextFrom === -1 ? rest : rest.slice(0, nextFrom);
  const m = /\.select\s*\(/.exec(window);
  if (!m) return null;
  const start = fromEnd + m.index + m[0].length;
  let depth = 1;
  let out = "";
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          out += src[i];
          i++;
        }
        out += src[i];
        i++;
      }
      out += quote;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      depth--;
      if (depth === 0) return out;
    }
    out += c;
  }
  return null; // unterminated: the caller treats null as "could not extract"
}

/** True when the argument is a wildcard: it starts with `*`, or has a top-level `*` item. */
function isWildcard(arg: string): boolean {
  const trimmed = arg.trim();
  if (/^["'`]\s*\*/.test(trimmed)) return true;
  if (trimmed === "") return true; // `.select()` returns every column
  // top-level items of the first string/template argument, split on commas outside brackets
  let depth = 0;
  let item = "";
  const items: string[] = [];
  for (const c of trimmed) {
    if (c === "(" || c === "[" || c === "{") depth++;
    if (c === ")" || c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) {
      items.push(item);
      item = "";
    } else {
      item += c;
    }
  }
  items.push(item);
  return items.some((it) => it.replace(/["'`\s]/g, "") === "*");
}

/** The declaration of `name` to the next column-0 `export` (or EOF). Never "the first column-0 }". */
function functionBody(src: string, name: string): string | null {
  const decl = new RegExp(`^export (?:async )?function ${name}\\b`, "m").exec(src);
  if (!decl) return null;
  const after = src.slice(decl.index + decl[0].length);
  const next = /^export\b/m.exec(after);
  return src.slice(decl.index, decl.index + decl[0].length + (next ? next.index : after.length));
}

function strategiesSelects(src: string): Array<{ arg: string | null; index: number }> {
  const out: Array<{ arg: string | null; index: number }> = [];
  for (const m of src.matchAll(FROM_STRATEGIES)) {
    const index = m.index ?? 0;
    out.push({ arg: selectArgAfter(src, index + m[0].length), index });
  }
  return out;
}

// ---------------------------------------------------------------- the pins

const ANON_READERS = ["getStrategiesByCategory", "getPublicStrategyDetail", "getFactsheetDetail"];

describe("ANONKEYID: STRATEGY_PUBLIC_COLUMNS_ARR", () => {
  it("holds 31 unique entries and never api_key_id", () => {
    expect(STRATEGY_PUBLIC_COLUMNS_ARR).toHaveLength(31);
    expect(new Set(STRATEGY_PUBLIC_COLUMNS_ARR).size).toBe(STRATEGY_PUBLIC_COLUMNS_ARR.length);
    expect(STRATEGY_PUBLIC_COLUMNS_ARR as readonly string[]).not.toContain("api_key_id");
  });
});

describe("ANONKEYID: the anonymous readers in src/lib/queries.ts project a key-free column list", () => {
  const src = readFileSync(QUERIES_PATH, "utf8");

  for (const name of ANON_READERS) {
    it(`${name} selects STRATEGY_PUBLIC_COLUMNS, no wildcard, no api_key_id`, () => {
      const body = functionBody(src, name);
      expect(body, `${name} was not found in src/lib/queries.ts (a missing extraction must not pass)`).not.toBeNull();
      const selects = strategiesSelects(body!);
      expect(selects.length, `${name} has no .from("strategies") (a missing extraction must not pass)`).toBeGreaterThan(0);
      for (const { arg } of selects) {
        expect(arg, `${name}: the .select( after .from("strategies") could not be extracted`).not.toBeNull();
        expect(isWildcard(arg!), `${name} projects a strategies wildcard: anon loses SELECT on api_key_id, so this is a 42501 outage after the revoke. Select: ${arg}`).toBe(false);
        expect(arg, `${name} names api_key_id: anon holds no SELECT on it after the revoke. Select: ${arg}`).not.toContain("api_key_id");
        expect(arg, `${name} must project STRATEGY_PUBLIC_COLUMNS. Select: ${arg}`).toContain("STRATEGY_PUBLIC_COLUMNS");
      }
    });
  }
});

describe("ANONKEYID: the landing page's strategies count", () => {
  it('selects "id", never a wildcard', () => {
    const src = readFileSync(LANDING_PATH, "utf8");
    const counts = strategiesSelects(src).filter((s) => s.arg !== null && /count\s*:/.test(s.arg));
    expect(counts.length, "the landing strategies count (.select with { count }) was not found").toBe(1);
    const arg = counts[0].arg!;
    expect(isWildcard(arg), `the landing count projects a wildcard: a HEAD count expands it against the column grants. Select: ${arg}`).toBe(false);
    expect(/^\s*["'`]id["'`]\s*,/.test(arg), `the landing count must select "id". Select: ${arg}`).toBe(true);
  });
});

describe("ANONKEYID: anonymous route directories", () => {
  const files = ANON_ROUTE_DIRS.flatMap((d) => walk(join(REPO_ROOT, d)));

  it("walks a non-trivial file set (a wrong root must not read as clean)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no unexempted from(\"strategies\") selects a wildcard or names api_key_id", () => {
    const offenders: string[] = [];
    const exemptHits = new Map<string, number>();
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).split("\\").join("/");
      const src = readFileSync(file, "utf8");
      for (const { arg, index } of strategiesSelects(src)) {
        if (arg === null) continue; // an insert/update/delete chain, not a read
        if (!(isWildcard(arg) || arg.includes("api_key_id"))) continue;
        if (ANON_ROUTE_EXEMPTIONS[rel]) {
          exemptHits.set(rel, (exemptHits.get(rel) ?? 0) + 1);
          continue;
        }
        const line = src.slice(0, index).split("\n").length;
        offenders.push(`${rel}:${line}  select(${arg.replace(/\s+/g, " ").trim()})`);
      }
    }
    expect(
      offenders,
      "an anonymous-route file reads strategies with a wildcard or api_key_id. After the revoke that is a 42501 outage. Project STRATEGY_PUBLIC_COLUMNS, or add a reasoned entry to ANON_ROUTE_EXEMPTIONS if the read is not anon.",
    ).toEqual([]);
    // an exemption must match exactly: a stale one is dead weight, an excess hit is a new reader
    for (const [rel, { hits }] of Object.entries(ANON_ROUTE_EXEMPTIONS)) {
      expect(exemptHits.get(rel) ?? 0, `exemption for ${rel} expects ${hits} flagged select(s)`).toBe(hits);
    }
  });
});
