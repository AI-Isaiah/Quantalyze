import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 148 (OWN-02) — owner-lane / shared-cache isolation guard.
 *
 * WHY THIS EXISTS: `factsheet/[id]/v2/page.tsx` now serves TWO lanes off one
 * route. Lane A is the public/published lane and reads through
 * `unstable_cache`. Lane B is the owner lane: an authenticated owner reading
 * their OWN unpublished strategy. The effective unstable_cache key on this
 * route is id-ONLY — the `::computedAt` suffix the page passes is split off and
 * DISCARDED, and Next derives the entry from the callback source text plus
 * `["factsheet-v2-payload-v6", id]`. So an entry populated under an
 * owner-inclusive predicate would be handed to every subsequent reader of that
 * id — anonymous ones included — for the full 3600s TTL. That is a disclosure
 * bug, not a staleness bug.
 *
 * ROADMAP 148 SC2 has a structural clause: the shared factsheet cache is only
 * ever populated by the published-only builder, with the cached builder
 * unreachable from the owner lane. This file enforces it as a CI invariant, not
 * as an observation made once during the phase.
 *
 * WHY A STRUCTURAL LAYER AT ALL (the load-bearing argument). The 148-03
 * behaviour spec (`page.owner-lane.test.tsx`) pins the LANE WIRING: which lane
 * calls the cached wrapper, that the owner predicate is keyed to the session
 * user, that a non-owner 404s. It cannot see INSIDE the cached callback,
 * because its supabase mock does not actually filter — so dropping the
 * predicate there (mutation SC-2B-a below) leaves the behaviour file fully
 * green while shipping unfiltered rows into the shared cache. The asymmetry is
 * measured, not assumed (see the ledger). This file is the sole control for
 * that edit.
 *
 * WHAT IS PINNED:
 *
 *   1. `unstable_cache(` occurs EXACTLY once in page.tsx — one cache, one place
 *      to reason about. A second call site is a second policy.
 *   2. That call's callback body names `withPublishedOnly` as a LITERAL and
 *      never `withPublishedOrOwner`. The literal matters: a variable would mean
 *      the predicate is caller-supplied, which is exactly the disclosure shape.
 *   3. The `buildFactsheetPayloadCached` declaration head carries NO
 *      `visibility` / `StrategyVisibility` token — the 148-02 type-level
 *      unrepresentability claim, restated as a NEGATIVE so it is
 *      formatting-independent. (Deliberately NOT a positive
 *      `(cacheKey: string)` substring assertion: the shipped declaration is
 *      formatted across three lines, so that literal does not exist in the
 *      source at all. It would pin formatting, not the seam, and would redden
 *      on any reflow.)
 *   4. REPO-WIDE: no production source other than page.tsx mentions
 *      `buildFactsheetPayloadCached` or `fetchAndBuildPayload` — the phase-147
 *      "no fifth reader" clause restated for factsheet payload resolution. An
 *      allowlist structurally cannot catch a brand-new offender file; a walk
 *      can.
 *   5. `generateMetadata` never contains `withPublishedOrOwner` (T-148-03:
 *      draft name/description must never reach <title>/OG, which are fetched by
 *      unauthenticated crawlers and cached by third parties).
 *   6. `export const dynamic = "force-dynamic"` survives — the RESPONSE-level
 *      pin, distinct from the DATA-level unstable_cache concern. Losing it
 *      would let an owner-rendered HTML response be cached and replayed to
 *      anonymous visitors (the tearsheet hazard class).
 *   7. Anti-vacuity: the extractor really did find a cache call with a
 *      non-empty callback body, and the stripped source really does still
 *      contain `withPublishedOrOwner` somewhere (the Lane B code). An empty
 *      offender list therefore means clean, not blind.
 *
 *   A missing page.tsx (rename/move) is a FAILURE, not a skip (Rule 12): the
 *   isolation invariant must travel with the file, never silently stop being
 *   enforced.
 *
 * Comment hygiene: every scan strips comments BEFORE matching, and that is
 * load-bearing TWICE here, not decoratively:
 *   - page.tsx's own prose names BOTH predicates and both builder functions
 *     (it documents the very hazard this file guards), so a bare grep would
 *     self-invalidate assertions 2 and 4.
 *   - `src/lib/factsheet/types.ts:545` is a COMMENT naming `fetchAndBuildPayload`
 *     ("branch of the read path (page.tsx `fetchAndBuildPayload`)"). An
 *     un-stripped repo walk would flag types.ts as an offender and the gate
 *     would be red on a healthy tree.
 *
 * Rule-9 NON-VACUITY — ledger PENDING. Two production mutations (148-VALIDATION.md
 * rows SC-2B-a / SC-2B-b) are run against this gate in the next commit; their
 * OBSERVED failure output is pasted here then. Until that commit lands, this
 * file is a gate whose falsifiability is asserted but not yet demonstrated.
 * The gate is 9/9 green on the fixed tree.
 */

const ROOT = join(__dirname, "..", "..");

/** The one surface this phase's cache-isolation property lives on. */
const PAGE = "src/app/factsheet/[id]/v2/page.tsx";

/** Read a pinned source fail-loud (missing file → explicit failure). */
function readSource(relPath: string): string {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) {
    throw new Error(
      `OWN-02 pinned source is missing: ${relPath}. A rename or move must ` +
        `carry this guard with it — a missing pinned source is a FAILURE, ` +
        `not a skip (the owner-lane / shared-cache isolation invariant would ` +
        `otherwise silently stop being enforced on that surface).`,
    );
  }
  return readFileSync(abs, "utf8");
}

/**
 * Strip `//` line comments and block comments so documentation prose can
 * neither redden nor green a scan. Load-bearing here: page.tsx's own header
 * names BOTH visibility predicates and BOTH builder functions, and
 * `src/lib/factsheet/types.ts` carries a comment naming `fetchAndBuildPayload`.
 * Line-oriented on purpose (a `//` inside a URL string literal survives, which
 * is harmless — nothing downstream treats a URL as code).
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
 * Paren-balanced argument list of the FIRST `<token>(` occurrence, or "" when
 * absent. Returns the text BETWEEN the outer parens.
 */
function callArgs(src: string, token: string): string {
  const needle = `${token}(`;
  const start = src.indexOf(needle);
  if (start === -1) return "";
  let i = start + needle.length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") depth -= 1;
    i += 1;
  }
  return src.slice(start + needle.length, i - 1);
}

/**
 * First TOP-LEVEL argument of an already-extracted argument list — i.e. the
 * slice up to the first comma that is not nested inside (), [] or {}. For
 * `unstable_cache(...)` that is the cache CALLBACK, which is the thing whose
 * body decides what gets written into the shared entry.
 */
function firstArgument(args: string): string {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) return args.slice(0, i).trim();
  }
  return args.trim();
}

/**
 * Index of the opening brace of a named function's BODY — i.e. the first `{`
 * AFTER the paren-balanced parameter list. Naively taking the first `{` after
 * the name is wrong: `generateMetadata({ params }: { params: … })` destructures
 * in its parameter list, so the first brace belongs to the signature, not the
 * body. Returns -1 when the function is absent.
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
 * The DECLARATION HEAD of a function: from the `function <name>` token up to
 * (excluding) the opening brace of its body. Carries the parameter list and the
 * return type — which is exactly where a visibility parameter would appear.
 */
function declarationHead(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  const brace = bodyBraceIndex(src, name);
  if (start === -1 || brace === -1) return "";
  return src.slice(start, brace);
}

/**
 * Brace-balanced body of a named function declaration (used for
 * `generateMetadata`, whose body must never reach the owner-inclusive
 * predicate).
 */
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

// ─────────────────────────────────────────────────────────────────────────
// The cached lane: exactly one cache, populated by exactly one predicate
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-02 — the shared factsheet cache can only ever be filled by the published-only builder", () => {
  it("page.tsx calls unstable_cache EXACTLY once (a second cache site is a second disclosure policy)", () => {
    const src = stripComments(readSource(PAGE));
    expect(countOccurrences(src, "unstable_cache(")).toBe(1);
  });

  it("the cached callback names withPublishedOnly as a LITERAL and never the owner-inclusive predicate", () => {
    const src = stripComments(readSource(PAGE));
    const callback = firstArgument(callArgs(src, "unstable_cache"));
    expect(callback).toContain("withPublishedOnly");
    // The failure this forbids is not hypothetical: the cache key is id-only,
    // so an owner-inclusive predicate here serves one owner's draft to every
    // later reader of that id, anonymous included, for the full TTL.
    expect(callback).not.toContain("withPublishedOrOwner");
  });

  it("the cached callback calls fetchAndBuildPayload with the published-only predicate spelled out, not a variable", () => {
    const src = stripComments(readSource(PAGE));
    const callback = firstArgument(callArgs(src, "unstable_cache"));
    // A variable in this position means the predicate became caller-supplied —
    // the exact shape 148-02 removed from the signature. The literal is the
    // property; `toContain` on the identifier alone would not see the
    // difference.
    expect(callback).toContain("fetchAndBuildPayload(id, withPublishedOnly)");
  });

  it("the cached wrapper takes NO visibility parameter (the seam is type-level unrepresentable, formatting-independent)", () => {
    const src = stripComments(readSource(PAGE));
    const head = declarationHead(src, "buildFactsheetPayloadCached");
    expect(head).not.toBe("");
    // NEGATIVE clauses only, on purpose. The shipped declaration spans three
    // lines, so a positive `(cacheKey: string)` substring does not exist and
    // asserting it would pin formatting rather than the seam. These two tokens
    // are what a re-widened signature must introduce.
    expect(head).not.toContain("visibility");
    expect(head).not.toContain("StrategyVisibility");
  });

  it("generateMetadata never reaches the owner-inclusive predicate (draft name/description can never enter <title> or the OG card)", () => {
    const src = stripComments(readSource(PAGE));
    const body = functionBody(src, "generateMetadata");
    expect(body).not.toBe("");
    expect(body).toContain("withPublishedOnly");
    expect(body).not.toContain("withPublishedOrOwner");
  });

  it("the route stays pinned to dynamic rendering (RESPONSE-level pin, distinct from the unstable_cache DATA-level one)", () => {
    const src = stripComments(readSource(PAGE));
    expect(src).toContain('export const dynamic = "force-dynamic"');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Repo-wide: no third factsheet-payload resolution mechanism
// ─────────────────────────────────────────────────────────────────────────

describe("OWN-02 — no production source outside the factsheet page resolves a factsheet payload", () => {
  /** Every `file — token` offender pair, empty on a healthy tree. */
  function offenders(): string[] {
    const found: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const rel = relative(ROOT, abs);
      if (rel === PAGE) continue;
      const src = stripComments(readFileSync(abs, "utf8"));
      for (const token of [
        "buildFactsheetPayloadCached",
        "fetchAndBuildPayload",
      ]) {
        if (src.includes(token)) found.push(`${rel} — ${token}`);
      }
    }
    return found;
  }

  it("no file other than the factsheet v2 page mentions buildFactsheetPayloadCached or fetchAndBuildPayload (a second caller is a second cache policy)", () => {
    // A repo-wide walk, not an allowlist: a brand-new file the gate author
    // never hand-picked is caught. Both builders are module-private today —
    // this keeps them that way, because a caller outside page.tsx would have no
    // access to the lane decision that makes the cached one safe.
    expect(offenders()).toEqual([]);
  });

  it("the walk is non-vacuous: it really does read production sources, and it really does strip comments", () => {
    const files = productionSources(join(ROOT, "src"));
    expect(files.length).toBeGreaterThan(100);
    // types.ts mentions `fetchAndBuildPayload` in a COMMENT. If stripComments
    // ever stopped being applied in the walk above, this file would be reported
    // as an offender and the gate would be red on a healthy tree — so the
    // stripping is load-bearing, not decorative.
    const typesRaw = readSource("src/lib/factsheet/types.ts");
    expect(typesRaw).toContain("fetchAndBuildPayload");
    expect(stripComments(typesRaw)).not.toContain("fetchAndBuildPayload");
  });

  it("the extractors are non-vacuous: a real callback body was found, and the owner predicate really is present elsewhere in the page", () => {
    const src = stripComments(readSource(PAGE));
    const callback = firstArgument(callArgs(src, "unstable_cache"));
    // Without this, an extractor that silently returned "" would make the
    // `not.toContain` clauses above pass on any tree at all.
    expect(callback.length).toBeGreaterThan(20);
    expect(callback).toContain("=>");
    // And the owner predicate IS in this file — on the Lane B path, outside the
    // cache. Its total absence would mean the owner lane was deleted, which
    // must not read as "cache isolation holds".
    expect(src).toContain("withPublishedOrOwner");
  });
});
