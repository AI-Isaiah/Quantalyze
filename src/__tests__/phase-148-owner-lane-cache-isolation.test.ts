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
 *   4. REPO-WIDE, TWO TOKENS WITH TWO DIFFERENT RULES (amended 2026-08-27,
 *      phase 164 ruling D-06 — the builder moved to the lib package so a second,
 *      tokenized recipient lane can call it without importing a page module):
 *
 *      4a. `buildFactsheetPayloadCached` — RULE UNCHANGED. No production source
 *          other than page.tsx may mention it. The cached wrapper is what makes
 *          the id-only key dangerous, and the lane decision that makes it safe
 *          lives in page.tsx and nowhere else. It did NOT move.
 *      4b. `fetchAndBuildPayload` — MODULE PIN, stronger than the two-caller
 *          allow-list the first D-06 draft proposed. (i) Exactly ONE production
 *          file may contain a `function fetchAndBuildPayload` DECLARATION, and
 *          it must be `src/lib/factsheet/fetch-and-build-payload.ts`; (ii) every
 *          OTHER production file whose comment-stripped source names the
 *          identifier must also carry the literal import specifier
 *          `@/lib/factsheet/fetch-and-build-payload`. So a new consumer is legal
 *          only through the canonical module, and a second builder — a copy, a
 *          re-declaration, a "just for the token lane" variant — is structurally
 *          impossible. That matters because the entire SL-1 disclosure argument
 *          rests on both lanes producing the SAME bytes from the SAME builder.
 *
 *      An allowlist structurally cannot catch a brand-new offender file; a walk
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
 * Rule-9 NON-VACUITY — TWO experiments run during authoring (2026-08-05) at two
 * INDEPENDENT sites, recorded here, in the commit message, and in
 * 148-VALIDATION.md rows SC-2B-a / SC-2B-b:
 *
 *   1. PREDICATE DROP AT THE PAYLOAD-BUILD SITE (SC-2B-a). The cached callback
 *      `async () => fetchAndBuildPayload(id, withPublishedOnly)` was changed to
 *      `async () => fetchAndBuildPayload(id, (q) => q)` — an identity
 *      predicate. This is the scariest realistic regression on this route: the
 *      builder runs on the SERVICE-ROLE admin client, where the injected
 *      predicate is the ONLY gate, so an identity predicate caches UNFILTERED
 *      rows and serves a draft strategy to anonymous readers for the full TTL.
 *      Two assertions went red:
 *
 *        × the cached callback names withPublishedOnly as a LITERAL and never
 *          the owner-inclusive predicate
 *          AssertionError: expected 'async () => fetchAndBuildPayload(id, …' to
 *          contain 'withPublishedOnly'
 *          Received: "async () => fetchAndBuildPayload(id, (q) => q)"
 *        × the cached callback calls fetchAndBuildPayload with the published-only
 *          predicate spelled out, not a variable
 *          AssertionError: expected 'async () => fetchAndBuildPayload(id, …' to
 *          contain 'fetchAndBuildPayload(id, withPublishe…'
 *          Received: "async () => fetchAndBuildPayload(id, (q) => q)"
 *
 *        → 2 failed / 7 passed in this file.
 *
 *      MEASURED ASYMMETRY — this is the whole reason the file exists, not a
 *      gap in it. Under the SAME mutation the 148-03 behaviour spec
 *      `page.owner-lane.test.tsx` stayed 10/10 GREEN ("Tests 10 passed (10)").
 *      Its supabase double does not apply the injected predicate, so no
 *      behavioural assertion can observe the predicate being dropped. For this
 *      edit the structural gate is the SOLE control.
 *
 *   2. SIGNATURE-GATE MUTATION (SC-2B-b) — a DIFFERENT site, not a repeat of
 *      the first. `buildFactsheetPayloadCached(cacheKey: string)` was widened to
 *      `(cacheKey: string, visibility: StrategyVisibility)`, `visibility` was
 *      threaded into the callback in place of the literal, and the Lane A call
 *      site passed `withPublishedOnly` in. `npm run typecheck` stayed at 0
 *      errors — this is the edit a well-meaning refactor actually makes, and
 *      the type system cannot object to it once the seam is re-opened. Three
 *      assertions went red:
 *
 *        × the cached callback names withPublishedOnly as a LITERAL and never
 *          the owner-inclusive predicate
 *          Received: "async () => fetchAndBuildPayload(id, visibility)"
 *        × the cached callback calls fetchAndBuildPayload with the published-only
 *          predicate spelled out, not a variable
 *          AssertionError: expected 'async () => fetchAndBuildPayload(id, …' to
 *          contain 'fetchAndBuildPayload(id, withPublishe…'
 *        × the cached wrapper takes NO visibility parameter (the seam is
 *          type-level unrepresentable, formatting-independent)
 *          AssertionError: expected 'function buildFactsheetPayloadCached(…'
 *          not to contain 'visibility'
 *          + function buildFactsheetPayloadCached(
 *          +   cacheKey: string,
 *          +   visibility: StrategyVisibility,
 *          + ): Promise<FactsheetPayload | null>
 *
 *        → 3 failed / 6 passed in this file, with tsc at 0.
 *
 *   Both mutations were reverted by RE-EDITING the mutated lines (never a
 *   file-level `git checkout --`), and `git diff --quiet -- page.tsx` exits 0.
 *   The gate is 9/9 green on the fixed tree.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AMENDMENT 2026-08-27 — phase 164, ruling D-06 (reviewed, not incidental).
 *
 * `fetchAndBuildPayload` moved VERBATIM out of page.tsx into
 * `src/lib/factsheet/fetch-and-build-payload.ts` so the tokenized recipient
 * lane (`/factsheet-share/[token]`) can call the SAME builder without importing
 * a Next.js page module. `buildFactsheetPayloadCached` did NOT move and its
 * rule is untouched. Pin 4 therefore splits into 4a / 4b above: page-private
 * for the wrapper, canonical-module for the builder.
 *
 * Why a module pin rather than the two-caller allow-list the first draft of
 * D-06 proposed: an allow-list answers "who may call it", which is the wrong
 * question. The property that keeps the token lane safe is that there is ONE
 * builder, so both lanes emit the same bytes for the same id. A module pin says
 * exactly that, and it stays correct when a third consumer appears.
 *
 * Rule-9 NON-VACUITY — THREE experiments run during this amendment (2026-08-27),
 * one per new assertion, each a temporary production file under `src/`:
 *
 *   3. BUILDER NAMED WITHOUT THE CANONICAL IMPORT (rule 4b(ii)).
 *      `src/lib/__gate_demo__/a.ts` containing only
 *      `export const note = "fetchAndBuildPayload is reachable from here";`
 *      × every other production file that names fetchAndBuildPayload imports it
 *        from the canonical module (D-06)
 *        + "src/lib/__gate_demo__/a.ts — fetchAndBuildPayload without
 *           @/lib/factsheet/fetch-and-build-payload"
 *      → 1 failed / 11 passed.
 *
 *   4. DUPLICATE BUILDER DECLARATION (rule 4b(i)). The same file rewritten to
 *      `export async function fetchAndBuildPayload() { … }` WHILE importing the
 *      canonical specifier — i.e. it satisfies 4b(ii) and is still caught:
 *      × exactly ONE production file declares fetchAndBuildPayload, and it is
 *        the canonical lib module (D-06)
 *        + "src/lib/__gate_demo__/a.ts"
 *      → 1 failed / 11 passed. This is the experiment that shows the module pin
 *        is strictly stronger than an import-path check on its own.
 *
 *   5. CACHED WRAPPER NAMED OUTSIDE THE PAGE (rule 4a, unchanged rule but a
 *      re-proved gate after the refactor of `offenders()` into two functions):
 *      × no file other than the factsheet v2 page mentions
 *        buildFactsheetPayloadCached
 *        + "src/lib/__gate_demo__/a.ts — buildFactsheetPayloadCached"
 *      → 1 failed / 11 passed.
 *
 *   All three were restored by DELETING the temporary directory (never a
 *   file-level `git checkout --`, which would have destroyed the uncommitted
 *   move). The gate is 12/12 green on the moved tree, with `tsc --noEmit` at 0.
 */

const ROOT = join(__dirname, "..", "..");

/** The one surface this phase's cache-isolation property lives on. */
const PAGE = "src/app/factsheet/[id]/v2/page.tsx";

/**
 * The canonical home of the payload builder (phase 164 / D-06). The cached
 * wrapper stayed on PAGE; only the builder moved here.
 */
const BUILDER = "src/lib/factsheet/fetch-and-build-payload.ts";

/**
 * The import specifier every consumer of the builder must use. Deliberately the
 * `@/` alias form and not a relative path: one spelling means one thing to
 * grep, to this gate, and to a reviewer.
 */
const BUILDER_SPECIFIER = "@/lib/factsheet/fetch-and-build-payload";

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
  /**
   * Rule 4a — the CACHED WRAPPER is page-private. Every `file — token` offender
   * pair, empty on a healthy tree.
   */
  function cachedWrapperOffenders(): string[] {
    const found: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const rel = relative(ROOT, abs);
      if (rel === PAGE) continue;
      const src = stripComments(readFileSync(abs, "utf8"));
      if (src.includes("buildFactsheetPayloadCached")) {
        found.push(`${rel} — buildFactsheetPayloadCached`);
      }
    }
    return found;
  }

  /**
   * Rule 4b(i) — every production file carrying a `function fetchAndBuildPayload`
   * DECLARATION. Exactly one is legal, and it is BUILDER. The substring covers
   * `export async function fetchAndBuildPayload(` as shipped, and it would also
   * catch a bare `function fetchAndBuildPayload` copied into a new file.
   */
  function builderDeclarers(): string[] {
    return productionSources(join(ROOT, "src"))
      .filter((abs) =>
        stripComments(readFileSync(abs, "utf8")).includes(
          "function fetchAndBuildPayload",
        ),
      )
      .map((abs) => relative(ROOT, abs));
  }

  /**
   * Rule 4b(ii) — every production file that NAMES the builder but is neither
   * its canonical home nor an importer of the canonical specifier. A file here
   * has either re-declared the builder or reached it by some other path, and
   * both break the "one builder, same bytes on both lanes" SL-1 argument.
   */
  function builderNonImporters(): string[] {
    const found: string[] = [];
    for (const abs of productionSources(join(ROOT, "src"))) {
      const rel = relative(ROOT, abs);
      if (rel === BUILDER) continue;
      const src = stripComments(readFileSync(abs, "utf8"));
      if (!src.includes("fetchAndBuildPayload")) continue;
      if (src.includes(BUILDER_SPECIFIER)) continue;
      found.push(`${rel} — fetchAndBuildPayload without ${BUILDER_SPECIFIER}`);
    }
    return found;
  }

  it("no file other than the factsheet v2 page mentions buildFactsheetPayloadCached (a second caller is a second cache policy)", () => {
    // A repo-wide walk, not an allowlist: a brand-new file the gate author
    // never hand-picked is caught. The cached wrapper is module-private to
    // page.tsx and stays that way, because a caller outside page.tsx would have
    // no access to the lane decision that makes it safe.
    expect(cachedWrapperOffenders()).toEqual([]);
  });

  it("exactly ONE production file declares fetchAndBuildPayload, and it is the canonical lib module (D-06)", () => {
    // A duplicate builder is the failure this forbids. Two builders drifting
    // apart would mean the token lane and the owner lane no longer produce the
    // same bytes for the same id — and the whole SL-1 argument is that they do.
    expect(builderDeclarers()).toEqual([BUILDER]);
  });

  it("every other production file that names fetchAndBuildPayload imports it from the canonical module (D-06)", () => {
    // Stronger than a two-caller allow-list: a NEW consumer is legal, but only
    // through `@/lib/factsheet/fetch-and-build-payload`. Reaching the builder
    // any other way — a copy, a re-export chain, a local re-declaration — is an
    // offender the walk catches without the gate author having to predict it.
    expect(builderNonImporters()).toEqual([]);
  });

  it("the page still imports the builder from its canonical home (the seam is real, not a name collision)", () => {
    // Without this, `builderNonImporters()` could pass on a tree where the page
    // stopped calling the builder at all — a green gate over a deleted lane.
    const pageSrc = stripComments(readSource(PAGE));
    expect(pageSrc).toContain(BUILDER_SPECIFIER);
    expect(pageSrc).toContain("fetchAndBuildPayload");
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
