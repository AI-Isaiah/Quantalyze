import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as seamDiscriminator from "./seam-discriminator";

/**
 * Phase 140.2 / SEAMCORE-01 + SEAMCORE-08 (ROADMAP SC6, clause a) — the
 * discriminator leaf stays dependency-free.
 *
 * Same shape and same reasoning as `seam-errors.purity.test.ts`, for a second
 * leaf. It is a separate file rather than a generalised sweep on purpose: the
 * two leaves have DIFFERENT exported surfaces and different reasons for
 * existing, and a shared parameterised guard would have to weaken the
 * set-equality half to the intersection of both — which is the assertion that
 * actually catches a member being added or removed.
 *
 * TWO INDEPENDENT CONSTRAINTS force the purity, and the failure messages below
 * name both, because a future editor who only knows one of them will "fix" the
 * other away:
 *
 *  1. BUNDLE BOUNDARY. Plan `140.3-01` applies this predicate at a `"use client"`
 *     component, so a dependency added here reaches the BROWSER bundle. Anything
 *     seam-adjacent drags `@upstash/redis`, `@upstash/ratelimit` and a
 *     `Redis.fromEnv()` module-load side effect in with it — and the obvious
 *     "tidy-up" here is exactly the wrong one: importing the closed
 *     service-dependency vocabulary from `resilient-fetch.ts` to remove the
 *     duplication would do all of that in one line, and would ALSO destroy the
 *     independence that makes the two hand-typed vocabularies falsifiable
 *     against each other.
 *
 *  2. MOCK SURVIVAL. Sixteen route test files replace the seam clients
 *     wholesale, most with a full factory and no `importActual`. A predicate
 *     reached THROUGH such a module evaluates to `undefined`, and calling it
 *     throws a TypeError from INSIDE a catch block — converting a clean 503 into
 *     a crash. Nothing mocks this leaf, so it holds under every existing mock
 *     shape. That property survives only while it imports nothing worth mocking.
 *
 * ORACLE INDEPENDENCE. Every expected value here is a hand-typed literal. The
 * exported-name set is typed in this file, never read back out of the module it
 * guards.
 *
 * GREP-GATE HYGIENE. The source is comment-stripped BEFORE matching and the
 * patterns are additionally anchored with `^` under `/m`. Either alone would do;
 * both are kept because this phase hit prose-defeats-the-guard three times, once
 * in the very commit that documented the rule. Without the strip, the leaf's own
 * docblock — which necessarily discusses imports — would satisfy an unanchored
 * pattern and the guard would pass on a file that had been ruined.
 */

const LEAF_PATH = "src/lib/seam-discriminator.ts";

/**
 * Whole-line comments and block comments go; a trailing comment stays. Leaving
 * trailing comments in can only produce a FALSE POSITIVE (a guard that fails
 * when it should not), which is the safe direction for a purity assertion.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const LEAF_CODE = stripComments(
  readFileSync(join(process.cwd(), LEAF_PATH), "utf8"),
);

/**
 * The leaf's exported surface, typed HERE as a literal.
 *
 * FIVE members, and deliberately a SET rather than a lower bound. The closed
 * service-dependency vocabulary and the global-key literal are NOT exported and
 * must not become so: everything exported from a leaf is browser-reachable and
 * survives every wholesale seam mock, and a consumer that imported the
 * vocabulary could build its own key from it — the one thing threat T-140-01
 * exists to prevent. The verdict function is the ONE key builder.
 *
 * `seamDependencyName` was added by 140.3-11 / TS-18 and is the FOURTH member.
 * The decision it records — and the reason it is a narrow, purpose-named
 * extractor rather than an export of the private `nestedDetail` reader or a
 * generic `field` getter — is written at its declaration in the leaf. Exporting
 * `nestedDetail` would have handed every consumer the whole envelope and made
 * the next hand-rolled `body.detail` branch a one-liner, which is the class
 * `140.3-01` closed. A generic getter would have made this set unable to say
 * WHICH fields are reachable, which is the only thing it is for.
 *
 * ✅ `140.3-15` / TS-20 DID EXACTLY THAT. `seamCorrelationId` is the FIFTH
 * member, built on the same private `nestedDetail`, mirroring `seamErrorCode`'s
 * both-shape read because `correlation_id` is TOP-LEVEL on the app-global flat
 * envelopes and NESTED on `service_error`. It is neither a private reader of
 * its own nor a widening of `seamDependencyName`, so there is ONE recorded
 * mechanism for this leaf rather than two rival ones — which is the drift this
 * programme exists to close. The instruction above is preserved as the record
 * of the decision it was routed under.
 *
 * ⚠️ The value it returns is rendered VERBATIM into a user's DOM and copied to
 * their clipboard, and on the app-global handlers it originates as a
 * caller-supplied request header. Its SHAPE guard lives at its declaration in
 * the leaf and duplicates `CORRELATION_ID_SHAPE` in `src/lib/correlation-id.ts`
 * by necessity — that module imports `server-only` and `next/headers`, both of
 * which this file's first four assertions forbid here.
 */
const EXPECTED_EXPORTS: string[] = [
  "seamBreakerVerdict",
  "seamCorrelationId",
  "seamDependencyName",
  "seamErrorCode",
  "seamHumanMessage",
];

const PURITY_RATIONALE =
  "Two things break at once. (1) BUNDLE BOUNDARY: plan 140.3-01 applies this " +
  "predicate at a \"use client\" component, so a dependency added here ships to " +
  "the browser — including, for anything seam-adjacent, a Redis client and a " +
  "module-load side effect. (2) MOCK SURVIVAL: sixteen route tests replace the " +
  "seam clients wholesale, and a predicate reached through a wholesale mock " +
  "evaluates to undefined and throws a TypeError from inside a catch block, " +
  "turning a clean 503 into a crash. If this leaf genuinely needs a dependency, " +
  "the predicate has to move — widening this guard is never the fix. In " +
  "particular: do NOT import the service-dependency vocabulary from " +
  "resilient-fetch.ts to de-duplicate it. That duplication is the falsifier.";

describe("[SEAMCORE-01 / SC6-a] seam-discriminator.ts is a dependency-free leaf", () => {
  it("contains no import statement", () => {
    expect(
      /^\s*import\s/m.test(LEAF_CODE),
      `${LEAF_PATH} now has an import statement. ${PURITY_RATIONALE}`,
    ).toBe(false);
  });

  it("contains no re-export from another module", () => {
    // `export … from "…"` is a dependency edge exactly like an import: it makes
    // the other module part of this one's graph in both bundles.
    expect(
      /^\s*export\s[^\n]*\bfrom\s/m.test(LEAF_CODE),
      `${LEAF_PATH} now re-exports from another module, which is an import in ` +
        `everything but name. ${PURITY_RATIONALE}`,
    ).toBe(false);
  });

  it("contains no require() call", () => {
    expect(
      /\brequire\s*\(/.test(LEAF_CODE),
      `${LEAF_PATH} now calls require(). ${PURITY_RATIONALE}`,
    ).toBe(false);
  });

  it("reads no environment variable", () => {
    // An env read is a module-load side effect in the browser bundle, where the
    // variable does not exist — and a discriminator whose verdict could vary by
    // environment is worse than one that cannot: the breaker would classify
    // differently in preview and production with nothing to see it.
    expect(
      /process\.env/.test(LEAF_CODE),
      `${LEAF_PATH} now reads process.env. The leaf must be inert at module ` +
        `load in BOTH bundles. ${PURITY_RATIONALE}`,
    ).toBe(false);
  });

  it("exports exactly the hand-typed predicate set (SET equality, not a count)", () => {
    // A length check passes a RENAME, measured in plan 140.2-02: renaming a
    // budget key left the count unchanged and only the set equality saw it.
    expect(
      Object.keys(seamDiscriminator).sort(),
      `${LEAF_PATH}'s exported surface drifted. Everything exported from this ` +
        `leaf is reachable from the browser bundle and survives every wholesale ` +
        `seam mock — both are privileges, so adding or removing a member is a ` +
        `decision to record here in the same commit, not a side effect. If the ` +
        `new member is the dependency vocabulary or a key literal, the answer is ` +
        `no: the verdict function is the ONE key builder (T-140-01).`,
    ).toEqual([...EXPECTED_EXPORTS].sort());
  });
});
