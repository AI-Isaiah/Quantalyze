import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 149 (NAV-01) — "my strategies at discovery parity" structural gate.
 *
 * WHY THIS EXISTS: this phase gave an OWNER surface the SHARED discovery
 * ranking. One component (`StrategyTable`), one scoring core
 * (`scoreAgainstPopulation`), one published-universe predicate helper
 * (`withPublishedOnly`) — now serving both `/discovery/[slug]` + `/browse/[slug]`
 * (anonymous readers) and `/my-strategies` (an owner reading their OWN private
 * and draft rows). Reuse is the phase's whole point AND its whole hazard: the
 * exact edit that widens the owner surface by one token also widens the public
 * one, because it is literally the same code.
 *
 * ROADMAP 149 SC-3 states the property in its own words — structural reuse
 * ASSERTED, not merely observed, with the public predicate "provably unchanged".
 * This file is what makes those two words true: an edit-time CI invariant rather
 * than an observation somebody made once during execution.
 *
 * WHY A STRUCTURAL LAYER AT ALL (the load-bearing argument). The phase already
 * ships four behavioural specs — `StrategyTable.visibility.test.tsx`,
 * `StrategyTable.pending-chip.test.tsx`, `queries.my-strategies.test.ts` and
 * `my-strategies/page.test.tsx`. Every one of them pins a RENDER OUTCOME or a
 * RETURN VALUE for a mount the spec itself constructs. None of them can see what
 * the PUBLIC CALL SITES pass, because none of them render
 * `discovery/[slug]/page.tsx` or `browse/[slug]/page.tsx` — those are RSCs that
 * would need the whole supabase stack faked to mount. Adding
 * `visibility="owner-all-statuses"` to the browse page therefore leaves the
 * entire behavioural suite green while serving every user's drafts to anonymous
 * readers through the shared component. Only a source scan sees a prop that is
 * absent. The asymmetry is MEASURED, not assumed — see the Rule-9 ledger below,
 * mutations M2 and M9.
 *
 * WHAT IS PINNED (one `it()` per numbered pin, so a failure names the offender):
 *
 *   1. `StrategyTable.tsx` still carries the destructuring default
 *      `visibility = "published-only"` AND still carries the published arm
 *      `strategies.filter((s) => s.status === "published")`. The default
 *      EXPRESSION is the public invariant — every existing call site relies on
 *      it — and the surviving filter proves the in-component predicate was
 *      PARAMETERIZED, never deleted (deleting it would widen a SHARED client
 *      component for every consumer at once).
 *   2. `discovery/[slug]/page.tsx` and `browse/[slug]/page.tsx` pass NO
 *      `visibility=`, NO `placeholderKeys` and NO `onFinishSetup`. Absence-as-
 *      assertion: this is what "provably unchanged" means for a call site.
 *   3. `getStrategiesByCategory`'s body still routes through `withPublishedOnly(`
 *      — the public list read.
 *   4. `getMyStrategies`'s body is own-only and archived-excluded
 *      (`.eq("user_id"` + `.neq("status", "archived")`) and reaches NEITHER
 *      `withPublishedOrOwner` (published-OR-own would render the whole published
 *      universe on a page titled "My Strategies") NOR
 *      `discovery_categories!inner` (an `!inner` miss silently hides the owner's
 *      uncategorised drafts).
 *   5. `getPercentiles` keeps its `categorySlug?: string` signature (the CONTEXT
 *      lock, as re-read by the 2026-08-05 scorer ruling) and its comment-stripped
 *      body contains EXACTLY TWO `withPublishedOnly(` occurrences — an occurrence
 *      COUNT, not a presence check — and never `user_id`.
 *   6. `my-strategies/page.tsx` calls `getOwnRowPercentiles(` and its
 *      comment-stripped source contains NO `getPercentiles(` token: the
 *      published-universe query runs ONCE per owner request, inside the helper
 *      (the I-2 single-fetch ruling). `getPercentiles` stays the
 *      discovery-surface caller of the SAME core, so pin 9's "both callers"
 *      property is unaffected.
 *   7. `StrategyTable.tsx` still derives
 *      `const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;`
 *      (grid is unreachable on the owner recipe) and still gates
 *      `<SimulateImpactButton>` on `s.status === "published"`.
 *   8. `getStrategylessActiveKeys`'s body reads `strategy_keys` owner-scoped
 *      (`.eq("owner_id", userId)`) and delegates to `deriveStrategylessKeys(`;
 *      `deriveStrategylessKeys`'s body applies `isPerKeyDailiesEligibleKey` and
 *      carries the `"archived"` literal (archived ≠ coverage — W-4).
 *   9. SINGLE SCORING CORE (founder scorer ruling): `getPercentiles` AND
 *      `getOwnRowPercentiles` EACH delegate to `scoreAgainstPopulation(`, and
 *      comment-stripped `queries.ts` contains NO inversion arm — the
 *      `100 - percentile` step lives in `percentile-core.ts` and nowhere else.
 *  10. REPO WALK: exactly ONE production file passes
 *      `visibility="owner-all-statuses"`, and its path is the my-strategies
 *      surface. No second widening consumer.
 *  11. REPO WALK: exactly ONE production file exports `StrategyTable` and
 *      exactly ONE exports `scoreAgainstPopulation` — SC-3's literal "no second
 *      ranking implementation", plus its scoring twin.
 *  12. Anti-vacuity: every extractor really found a body, the strippers really
 *      stripped, and the walk really found the my-strategies file. An empty
 *      offender list means clean, not blind.
 *
 *  A missing pinned source (rename/move) is a FAILURE, not a skip (Rule 12): the
 *  invariant must travel with the file, never silently stop being enforced.
 *
 * Comment hygiene: every scan strips comments BEFORE matching, and that is
 * load-bearing here, not decorative — THREE times over:
 *   - `my-strategies/page.tsx` names `getPercentiles` FOUR times in `//` prose
 *     (it documents the single-fetch ruling it implements), so pin 6's negative
 *     would self-invalidate on an unstripped read.
 *   - `StrategyTable.tsx`'s prop documentation names `owner-all-statuses` and
 *     spells out `status === "published"`, so pins 1/7 must not be able to pass
 *     on prose alone.
 *   - `percentile-core.ts`'s header prints the formula `percentile = 100 - percentile`
 *     verbatim; pin 9's inversion-arm ban is scoped to `queries.ts`, but the
 *     stripping is what keeps the regex honest if that prose is ever copied.
 * Every count-based assertion strips first and SELF-PINS its regex (the phase-32
 * idiom) — there is no bare `grep -c`-equivalent over unstripped source here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Rule-9 NON-VACUITY — the mutation campaign
 *
 * (EMPTY — filled by 149-05 task 2. Every row below is written only AFTER the
 * mutation was actually run and the failure actually observed; a mutation that
 * is not run is recorded as SKIPPED, never as caught.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ROOT = join(__dirname, "..", "..");

/** The shared ranking component both the public and the owner surfaces mount. */
const STRATEGY_TABLE = "src/components/strategy/StrategyTable.tsx";
/** Every server read this phase touched. */
const QUERIES = "src/lib/queries.ts";
/** The ONE scoring core. */
const PERCENTILE_CORE = "src/lib/percentile-core.ts";
/** The two PUBLIC category pages whose behaviour must be provably unchanged. */
const DISCOVERY_PAGE = "src/app/(dashboard)/discovery/[slug]/page.tsx";
const BROWSE_PAGE = "src/app/browse/[slug]/page.tsx";
/** The owner surface. */
const MY_STRATEGIES_PAGE = "src/app/(dashboard)/my-strategies/page.tsx";

/** Read a pinned source fail-loud (missing file → explicit failure, never a skip). */
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `NAV-01 pinned source is missing: ${relPath}. A rename or move must carry ` +
        `this guard with it — a missing pinned source is a FAILURE, not a skip ` +
        `(the "one ranking component, one scoring core, published-only on the ` +
        `public surfaces" invariant would otherwise silently stop being ` +
        `enforced on that file).`,
    );
  }
  return readFileSync(abs, "utf8");
}

/**
 * Strip block comments and `//` line comments so documentation prose can neither
 * redden nor green a scan. Load-bearing three times over — see the header's
 * comment-hygiene note. Line-oriented on purpose (a `//` inside a URL string
 * literal survives, which is harmless: nothing downstream treats a URL as code).
 */
function stripComments(src: string): string {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** Walk src/ for production sources (no tests, no __tests__, no .d.ts). */
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

/**
 * Index of the opening brace of a named function's BODY — the first `{` AFTER
 * the paren-balanced parameter list. Naively taking the first `{` after the name
 * is wrong: several of these functions destructure or take object-typed params,
 * so the first brace belongs to the signature. Returns -1 when absent.
 */
function bodyBraceIndex(src: string, name: string): number {
  const start = src.indexOf(`function ${name}`);
  if (start === -1) return -1;
  const paren = src.indexOf("(", start);
  if (paren === -1) return -1;
  let i = paren + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.indexOf("{", i);
}

/**
 * DECLARATION HEAD: from `function <name>` up to (excluding) the body brace.
 * Carries the parameter list and the return type — exactly where a signature
 * change would show up.
 */
function declarationHead(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  const brace = bodyBraceIndex(src, name);
  if (start === -1 || brace === -1) return "";
  return src.slice(start, brace);
}

/** Brace-balanced body of a named function declaration. */
function functionBody(src: string, name: string): string {
  const open = bodyBraceIndex(src, name);
  if (open === -1) return "";
  let i = open + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") depth -= 1;
    i += 1;
  }
  return src.slice(open + 1, i - 1);
}

/** Occurrences of a literal token in a source. */
function countOccurrences(src: string, token: string): number {
  let n = 0;
  let from = 0;
  for (;;) {
    const hit = src.indexOf(token, from);
    if (hit === -1) return n;
    n += 1;
    from = hit + token.length;
  }
}

/** Comment-stripped sources, read once. */
const strategyTableSrc = stripComments(readSource(STRATEGY_TABLE));
const queriesSrc = stripComments(readSource(QUERIES));
const myStrategiesPageSrc = stripComments(readSource(MY_STRATEGIES_PAGE));

// The literal derivation whose deletion re-opens the grid dead end (M9's site).
const EFFECTIVE_VIEW_MODE_DERIVATION =
  'const effectiveViewMode = visibility === "owner-all-statuses" ? "table" : viewMode;';
// The widening prop, as it appears at a JSX call site.
const WIDENING_PROP = 'visibility="owner-all-statuses"';
// The inversion arm. `[A-Za-z_]` on the right so an arithmetic `100 - 1` in
// unrelated code cannot masquerade as the formula (self-pinned below).
const INVERSION_ARM = /100\s*-\s*[A-Za-z_]/;
const EXPORTS_STRATEGY_TABLE = /export function StrategyTable\b/;
const EXPORTS_SCORING_CORE = /export function scoreAgainstPopulation\b/;

// ─────────────────────────────────────────────────────────────────────────
// Layer B — per-file literals: the public recipe and the owner recipe
// ─────────────────────────────────────────────────────────────────────────

describe("NAV-01 — the shared ranking component stays published-only by default", () => {
  it("pin 1 — the published-only DEFAULT survives as a literal, and the published arm was parameterized rather than deleted", () => {
    // The default EXPRESSION is the public invariant: /discovery and /browse
    // pass nothing, so whatever this expression says is what anonymous readers
    // get. The failure this forbids is not hypothetical — dropping the default
    // makes `visibility` undefined at every existing call site, which stops
    // matching "published-only" and hands the unfiltered prop array to the
    // memo.
    expect(strategyTableSrc).toContain('visibility = "published-only"');
    // And the arm itself must still EXIST. Deleting the in-component filter
    // (rather than branching it) would widen a SHARED client component for
    // every consumer at once — the single edit with the largest blast radius
    // in this phase.
    expect(strategyTableSrc).toContain(
      'strategies.filter((s) => s.status === "published")',
    );
  });

  it("pin 7 — grid view is unreachable on the owner recipe and Simulate stays gated on a published row", () => {
    // A grid card links to `${basePath}/${categorySlug}/${id}`, which resolves
    // through getStrategyDetail → withPublishedOnly → notFound(). On an owner
    // surface that is both a dead end AND an existence oracle. The DERIVATION
    // is the enforcement point (not a clamp on the `viewMode` state), so a
    // stale persisted `view: "grid"` preference cannot resurrect it.
    expect(strategyTableSrc).toContain(EFFECTIVE_VIEW_MODE_DERIVATION);

    // Simulate Impact is gated per ROW, so the gate is behaviour-invariant on
    // the public surfaces (where every row is published already). VERIFIED
    // analytics-service/routers/simulator.py:287-290 — the service fetches the
    // candidate filtered to published status and rejects anything else, so a
    // button on an own draft would fail on EVERY click.
    const mount = strategyTableSrc.indexOf("<SimulateImpactButton");
    expect(mount).toBeGreaterThan(-1);
    const guardWindow = strategyTableSrc.slice(Math.max(0, mount - 300), mount);
    expect(guardWindow).toContain('s.status === "published"');
  });
});

describe("NAV-01 — the two PUBLIC category pages pass nothing new (absence-as-assertion)", () => {
  for (const page of [DISCOVERY_PAGE, BROWSE_PAGE]) {
    it(`pin 2 — ${page} passes no visibility, placeholder or wizard prop`, () => {
      const src = stripComments(readSource(page));
      // The failure this forbids: ONE prop on a public page serves every user's
      // drafts to anonymous readers through the shared component. No behavioural
      // spec in this phase mounts these RSCs, so absence here is the only
      // control that exists (measured — see ledger M2).
      expect(src).not.toContain("visibility=");
      expect(src).not.toContain("placeholderKeys");
      expect(src).not.toContain("onFinishSetup");
      // Non-vacuity for THIS file: it really is the page that mounts the table.
      expect(src).toContain("<StrategyTable");
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — per-function predicates in queries.ts
// ─────────────────────────────────────────────────────────────────────────

describe("NAV-01 — the server predicates each stay exactly as narrow as their surface", () => {
  it("pin 3 — getStrategiesByCategory still routes the PUBLIC list read through withPublishedOnly", () => {
    const body = functionBody(queriesSrc, "getStrategiesByCategory");
    expect(body).not.toBe("");
    expect(body).toContain("withPublishedOnly(");
  });

  it("pin 4 — getMyStrategies is own-only and archived-excluded, and reaches neither the published-OR-own helper nor the category inner join", () => {
    const body = functionBody(queriesSrc, "getMyStrategies");
    expect(body).not.toBe("");
    expect(body).toContain('.eq("user_id"');
    // W-4: archived rows are excluded from the ranked list, matching
    // deriveStrategylessKeys treating an archived-only-covered key as bare.
    expect(body).toContain('.neq("status", "archived")');
    // The failure this forbids: `withPublishedOrOwner` is published-OR-own, so
    // on a page titled "My Strategies" it renders the ENTIRE published universe
    // — the ROADMAP's literal wording, overridden by the founder ruling
    // precisely because of this.
    expect(body).not.toContain("withPublishedOrOwner");
    // And an `!inner` category join silently DROPS the owner's uncategorised
    // drafts (category_id is nullable) — a disappearing-row bug that reads as
    // "you have no drafts".
    expect(body).not.toContain("discovery_categories!inner");
  });

  it("pin 5 — getPercentiles keeps its signature and BOTH withPublishedOnly branches (an occurrence COUNT, not a presence check)", () => {
    const head = declarationHead(queriesSrc, "getPercentiles");
    expect(head).not.toBe("");
    // CONTEXT lock, re-read by the 2026-08-05 scorer ruling: the SIGNATURE and
    // observable behaviour are unchanged; only the scoring core moved out.
    expect(head).toContain("categorySlug?: string");

    const body = functionBody(queriesSrc, "getPercentiles");
    expect(body).not.toBe("");
    // The failure this forbids: a category-scoped read keeps its branch
    // published-only while the GLOBAL branch silently widens. A presence check
    // is structurally blind to that — the scoped branch's occurrence keeps
    // `toContain` green. Only the count can see it (measured — ledger M4).
    expect(countOccurrences(body, "withPublishedOnly(")).toBe(2);
    // Predicate unchanged: own drafts structurally cannot enter the population
    // map any public surface reads.
    expect(body).not.toContain("user_id");
  });

  it("pin 8 — the strategyless-key census reads strategy_keys owner-scoped, and the pure anti-join treats archived as non-coverage", () => {
    const fetcher = functionBody(queriesSrc, "getStrategylessActiveKeys");
    expect(fetcher).not.toBe("");
    // BOTH link forms or the census lies: the founder's Alpha Centauri
    // composite carries 3 keys via strategy_keys with api_key_id NULL, so an
    // api_key_id-only anti-join fabricates 3 spurious "No strategy yet" rows on
    // the founder's own account (PROD census 2026-08-05).
    expect(fetcher).toContain("strategy_keys");
    expect(fetcher).toContain('.eq("owner_id", userId)');
    expect(fetcher).toContain("deriveStrategylessKeys(");

    const pure = functionBody(queriesSrc, "deriveStrategylessKeys");
    expect(pure).not.toBe("");
    // Eligibility is the SHARED predicate, not a re-derived copy of
    // `is_active && sync_status !== "revoked" && disconnected_at == null`.
    expect(pure).toContain("isPerKeyDailiesEligibleKey");
    // W-4: the owner archived it, so its key must reappear as a placeholder.
    expect(pure).toContain('"archived"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer B — the owner page's single fetch, and the single scoring core
// ─────────────────────────────────────────────────────────────────────────

describe("NAV-01 — one published-universe fetch, one scoring formula", () => {
  it("pin 6 — /my-strategies scores its own rows through getOwnRowPercentiles and makes NO second published-universe fetch", () => {
    expect(myStrategiesPageSrc).toContain("getOwnRowPercentiles(");
    // I-2 single-fetch ruling: the published universe is read ONCE per owner
    // request, inside the helper, and N for the comparison-set copy comes from
    // that same read. A re-introduced getPercentiles() call would be a second
    // full-table scan on every page load AND a second N that can disagree with
    // the map actually rendered.
    expect(myStrategiesPageSrc).not.toContain("getPercentiles(");
  });

  it("pin 9 — both percentile callers delegate to scoreAgainstPopulation, and queries.ts carries no second inversion arm", () => {
    const discoveryCaller = functionBody(queriesSrc, "getPercentiles");
    const ownerCaller = functionBody(queriesSrc, "getOwnRowPercentiles");
    expect(discoveryCaller).not.toBe("");
    expect(ownerCaller).not.toBe("");
    expect(discoveryCaller).toContain("scoreAgainstPopulation(");
    expect(ownerCaller).toContain("scoreAgainstPopulation(");

    // Self-pin the regex before trusting it (phase-32 idiom).
    expect(INVERSION_ARM.test("percentile = 100 - percentile;")).toBe(true);
    expect(INVERSION_ARM.test("percentile = 100-percentile;")).toBe(true);
    expect(INVERSION_ARM.test("const n = 100 - 1;")).toBe(false);

    // The failure this forbids: a second inline percentile formula that drifts
    // from the core — two rankings that disagree about the same number, one on
    // /discovery and one on /my-strategies, for the same strategy.
    expect(INVERSION_ARM.test(queriesSrc)).toBe(false);
    // ...and the arm really does live in the core (so its absence from
    // queries.ts means "extracted", never "deleted").
    expect(INVERSION_ARM.test(stripComments(readSource(PERCENTILE_CORE)))).toBe(
      true,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Layer A — repo walk: no second consumer, no second implementation
// ─────────────────────────────────────────────────────────────────────────

describe("NAV-01 — repo-wide: one widening consumer, one ranking implementation, one scoring core", () => {
  /** Production files whose stripped source passes the widening prop. */
  function wideningConsumers(): string[] {
    const found: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const src = stripComments(readFileSync(abs, "utf8"));
      if (src.includes(WIDENING_PROP)) found.push(relative(ROOT, abs));
    }
    return found;
  }

  /** Production files whose stripped source matches an export pattern. */
  function exporters(pattern: RegExp): string[] {
    const found: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const src = stripComments(readFileSync(abs, "utf8"));
      if (pattern.test(src)) found.push(relative(ROOT, abs));
    }
    return found;
  }

  it("pin 10 — exactly ONE production file widens the shared table to owner-all-statuses, and it is the my-strategies surface", () => {
    // A repo-wide walk, not an allowlist: a brand-new file the gate author
    // never hand-picked is caught. The failure this forbids: a second surface
    // opting into the owner recipe without the owner-scoped SERVER query that
    // makes it safe — the prop does not narrow anything, it stops the component
    // re-narrowing an already-narrowed set.
    const consumers = wideningConsumers();
    expect(consumers).toHaveLength(1);
    expect(consumers[0]).toContain("my-strategies");
  });

  it("pin 11 — exactly ONE production file exports StrategyTable and exactly ONE exports the scoring core", () => {
    // SC-3 read literally: "no second ranking implementation". A forked copy of
    // the table is how a parameterized predicate silently stops being the only
    // predicate; a forked scorer is how two surfaces start disagreeing about
    // the same percentile.
    expect(exporters(EXPORTS_STRATEGY_TABLE)).toEqual([STRATEGY_TABLE]);
    expect(exporters(EXPORTS_SCORING_CORE)).toEqual([PERCENTILE_CORE]);
  });

  it("pin 12 — anti-vacuity: the extractors found real bodies, the strippers really stripped, and the walk really reads production sources", () => {
    // 1. The walk is real. An extractor that silently returned [] would make
    //    every `toHaveLength(1)` above pass on any tree at all.
    const files = productionSources(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(100);
    expect(wideningConsumers().length).toBeGreaterThan(0);

    // 2. stripComments is LOAD-BEARING, not decorative: my-strategies/page.tsx
    //    names getPercentiles in `//` prose (it documents the single-fetch
    //    ruling it implements). Un-stripped, pin 6's negative would be red on a
    //    healthy tree.
    const pageRaw = readSource(MY_STRATEGIES_PAGE);
    expect(pageRaw).toContain("getPercentiles");
    expect(stripComments(pageRaw)).not.toContain("getPercentiles(");

    // 3. The owner arm really is still in the STRIPPED component source — its
    //    total absence would mean the owner recipe was deleted, which must not
    //    read as "the public predicate holds".
    expect(strategyTableSrc).toContain("owner-all-statuses");

    // 4. Every function extractor used above found a real body (not "").
    for (const name of [
      "getStrategiesByCategory",
      "getMyStrategies",
      "getPercentiles",
      "getOwnRowPercentiles",
      "getStrategylessActiveKeys",
      "deriveStrategylessKeys",
    ]) {
      expect(
        functionBody(queriesSrc, name).length,
        `functionBody(queries.ts, "${name}") returned an empty/short body — ` +
          `every negative assertion scoped to it would pass vacuously`,
      ).toBeGreaterThan(100);
    }
    expect(declarationHead(queriesSrc, "getPercentiles").length).toBeGreaterThan(
      20,
    );

    // 5. The extractors really do scope: getPercentiles' body must NOT contain
    //    the whole file (a runaway brace-balance would swallow queries.ts and
    //    silently green pin 5's `user_id` negative into a red, or worse).
    expect(functionBody(queriesSrc, "getPercentiles").length).toBeLessThan(
      queriesSrc.length / 4,
    );
  });
});
