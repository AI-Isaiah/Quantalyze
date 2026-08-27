import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Phase 164 / SHARE-02 — SL-1 AS A STRUCTURAL INVARIANT, not a comment.
 *
 * ═══ WHY THIS FILE EXISTS: A MEASURED GAP, NOT A BELT-AND-BRACES ═══
 *
 * `164-05-PLAN.md` task 3 promised "two independent detectors, one defect":
 * the behavioural ordered spec (`page.cache-isolation.test.tsx`) and the
 * phase-148 structural guard. MEASURED 2026-08-28 under NEUTER-D — the token
 * page's payload fetch rewired through
 * `unstable_cache(..., ["factsheet-v2-payload-v6", id])`:
 *
 *   behavioural  -> Tests 3 failed | 1 passed (4)   ✅ caught it
 *   phase-148    -> Tests 12 passed (12)            ❌ did NOT catch it
 *
 * The second detector does not exist. `phase-148-owner-lane-cache-isolation.test.ts:382`
 * counts `unstable_cache(` occurrences in `factsheet/[id]/v2/page.tsx` ONLY;
 * a second call site in a DIFFERENT file is invisible to it. Its repo-wide
 * walks ban two SYMBOLS (`buildFactsheetPayloadCached`, `fetchAndBuildPayload`)
 * and the neuter used neither — it inlined `unstable_cache` directly, which is
 * both the shortest path to the defect and the one a well-meaning "make the
 * recipient page faster" PR would actually take.
 *
 * Nor does plan 164-07 close it: that guard walks the TRANSITIVE IMPORT CLOSURE
 * of `fetch-and-build-payload.ts`. This page imports the builder; the builder
 * does not import the page, so the page is not in that closure and never will
 * be. The gap was unowned. This file owns it.
 *
 * ═══ WHAT IS PINNED ═══
 *
 *   1. The recipient page imports NOTHING from `next/cache`.
 *   2. Its comment-stripped source names no cache primitive at all —
 *      `unstable_cache`, `revalidateTag`, `revalidatePath`, `cacheTag`,
 *      `cacheLife` — nor `buildFactsheetPayloadCached`.
 *   3. `export const dynamic = "force-dynamic"` survives. This is the
 *      RESPONSE-level pin, distinct from the DATA-level one above: losing it
 *      would let a token-rendered HTML response be cached and replayed after a
 *      revoke, which no `revoked_at` filter can undo.
 *   4. Anti-vacuity: the stripped source is non-trivial and still names
 *      `fetchAndBuildPayload`. An empty offender list therefore means clean,
 *      not blind.
 *
 * ⛔ COMMENT STRIPPING IS LOAD-BEARING HERE, exactly as it is in phase-148.
 * The page's own 34-line header DOCUMENTS this hazard and names
 * `buildFactsheetPayloadCached` and `unstable_cache` in prose. A bare grep
 * would be red on a perfectly healthy tree, and the natural "fix" for that is
 * to delete the explanation — trading the comment that teaches the invariant
 * for a gate that never bites.
 *
 * ⛔ A MISSING PAGE IS A FAILURE, NOT A SKIP (Rule 12). If the route is renamed
 * or moved, this invariant must travel with it rather than silently stop being
 * enforced.
 */

const PAGE = join(process.cwd(), "src/app/factsheet-share/[token]/page.tsx");

/** Block comments, then whole-line `//` comments. Same shape as the phase-148
 *  stripper, re-typed rather than imported: a shared helper between two guards
 *  is one edit away from disarming both. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

function pageSource(): { raw: string; stripped: string } {
  expect(
    existsSync(PAGE),
    `${PAGE} is missing — the recipient route moved and the SL-1 invariant must move with it`,
  ).toBe(true);
  const raw = readFileSync(PAGE, "utf8");
  return { raw, stripped: stripComments(raw) };
}

/** Every Next cache primitive that could populate or bust a shared entry. */
const CACHE_PRIMITIVES = [
  "unstable_cache",
  "revalidateTag",
  "revalidatePath",
  "cacheTag",
  "cacheLife",
  "buildFactsheetPayloadCached",
] as const;

describe("[164 SHARE-02] the recipient token page has NO cache reach", () => {
  it("imports nothing from next/cache", () => {
    const { stripped } = pageSource();
    expect(
      stripped,
      "an import from next/cache on this lane is the SL-1 disclosure shape",
    ).not.toContain("next/cache");
  });

  it.each(CACHE_PRIMITIVES)("never names %s outside a comment", (symbol) => {
    const { stripped } = pageSource();
    expect(stripped).not.toContain(symbol);
  });

  it("stays pinned to dynamic rendering (RESPONSE-level, distinct from the DATA-level pin)", () => {
    const { stripped } = pageSource();
    expect(stripped).toContain('export const dynamic = "force-dynamic"');
  });

  it("anti-vacuity: the stripper left real code behind, and it still calls the shared builder", () => {
    const { raw, stripped } = pageSource();
    // If the stripper ate the file, every `not.toContain` above is vacuous.
    expect(stripped.length).toBeGreaterThan(400);
    expect(stripped).toContain("fetchAndBuildPayload");
    expect(stripped).toContain("export default async function");
    // And the header prose really does mention the banned symbols — so the
    // stripping is doing work, not sitting inert.
    expect(raw).toContain("buildFactsheetPayloadCached");
  });
});
