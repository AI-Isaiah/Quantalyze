import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as seamErrors from "./seam-errors";
import { CircuitOpenError } from "./seam-errors";

/**
 * Phase 140.2 / SEAMCORE-08 (ROADMAP SC6, clause a) — the dependency-free leaf
 * stays dependency-free.
 *
 * `src/lib/seam-errors.ts` has zero imports today, and its own docblock states
 * that this is load-bearing rather than stylistic. Nothing enforced it: before
 * this file, prepending a store import to the leaf was GREEN across the full
 * suite. There was no `seam-errors.test.ts` at all.
 *
 * TWO INDEPENDENT CONSTRAINTS force the purity, and the failure messages below
 * name both, because a future editor who only knows one of them will "fix" the
 * other away:
 *
 *  1. BUNDLE BOUNDARY. `src/lib/wizardErrors.ts` value-imports this class and is
 *     itself value-imported by ten `"use client"` components. A dependency here
 *     therefore reaches the BROWSER bundle. Homing the class where the seam
 *     lives would drag `@upstash/redis`, `@upstash/ratelimit` and a
 *     `Redis.fromEnv()` module-load side effect into it — the inverse of the
 *     `import "server-only"` convention the repo uses for modules that must
 *     never reach the client. This leaf is the mirror image: safe in EITHER
 *     bundle.
 *
 *  2. MOCK SURVIVAL. Sixteen route test files replace the seam clients
 *     wholesale, most with a full factory and no `importActual`. A class
 *     re-exported through such a module evaluates to `undefined`, and
 *     `err instanceof undefined` throws a TypeError from INSIDE a catch block —
 *     converting a clean 503 into a crash. Nothing mocks this leaf, so the
 *     narrowing holds under every existing mock shape. That property survives
 *     only while the leaf imports nothing worth mocking.
 *
 * ORACLE INDEPENDENCE. Every expected value here is a hand-typed literal. The
 * exported-name set and the error message are typed in this file, never read
 * back out of the module they guard.
 *
 * GREP-GATE HYGIENE. The source is comment-stripped BEFORE matching and the
 * patterns are additionally anchored with `^` under `/m`. Either alone would
 * do; both are kept because this phase hit prose-defeats-the-guard three times,
 * once in the very commit that documented the rule. Without the strip, the
 * leaf's own docblock — which necessarily discusses imports — would satisfy an
 * unanchored pattern and the guard would pass on a file that had been ruined.
 */

const LEAF_PATH = "src/lib/seam-errors.ts";

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
 * Exactly one member today. This is deliberately a set and not a lower bound:
 * plan 140.2-05 adds a second error class to this leaf, and having to edit this
 * literal is precisely the conscious decision the pin exists to force — the
 * same shape as the frozen four-path lint allowlist and the same shape as the
 * budget-key binding roster.
 */
const EXPECTED_EXPORTS: string[] = ["CircuitOpenError"];

/**
 * `CircuitOpenError`'s message, typed HERE as a literal (threat T-140-05).
 *
 * `verify-strategy` is the unauthenticated landing-page teaser and it reaches
 * the seam, so this string is reachable by an anonymous caller. It must carry
 * no upstream URL, no header name, no Python traceback and no request detail.
 */
const EXPECTED_CIRCUIT_OPEN_MESSAGE = "Analytics service circuit is open";

const PURITY_RATIONALE =
  "Two things break at once. (1) BUNDLE BOUNDARY: wizardErrors.ts value-imports " +
  "this class and ten \"use client\" components value-import wizardErrors, so a " +
  "dependency added here ships to the browser — including, for anything seam-" +
  "adjacent, a Redis client and a module-load side effect. (2) MOCK SURVIVAL: " +
  "sixteen route tests replace the seam clients wholesale, and `instanceof` " +
  "against a class reached through a wholesale mock evaluates against undefined " +
  "and throws a TypeError from inside a catch block, turning a clean 503 into a " +
  "crash. If this leaf genuinely needs a dependency, the class has to move — " +
  "widening this guard is never the fix.";

describe("[SEAMCORE-08 / SC6-a] seam-errors.ts is a dependency-free leaf", () => {
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
    // The leaf's own docblock claims "ZERO environment reads". An env read is
    // also a module-load side effect in the browser bundle, where the variable
    // does not exist.
    expect(
      /process\.env/.test(LEAF_CODE),
      `${LEAF_PATH} now reads process.env. The leaf must be inert at module ` +
        `load in BOTH bundles. ${PURITY_RATIONALE}`,
    ).toBe(false);
  });

  it("exports exactly the hand-typed class set (SET equality, not a count)", () => {
    // A length check passes a RENAME, measured in plan 140.2-02: renaming a
    // budget key left the count unchanged and only the set equality saw it.
    expect(
      Object.keys(seamErrors).sort(),
      `${LEAF_PATH}'s exported surface drifted. Everything exported from this ` +
        `leaf is reachable from the browser bundle and survives every wholesale ` +
        `seam mock — both are privileges, so adding or removing a member is a ` +
        `decision to record here in the same commit, not a side effect.`,
    ).toEqual([...EXPECTED_EXPORTS].sort());
  });
});

describe("[SEAMCORE-08 / T-140-05] CircuitOpenError leaks nothing", () => {
  it("carries the static message, byte-for-byte", () => {
    expect(
      new CircuitOpenError(30).message,
      "CircuitOpenError's message changed. It is rendered to ANONYMOUS callers " +
        "through the public verify-strategy teaser, so it must stay a static " +
        "infrastructure statement: no upstream URL, no header name, no status, " +
        "no traceback, no request detail. The diagnosable half belongs in the " +
        "server log next to the correlation id.",
    ).toBe(EXPECTED_CIRCUIT_OPEN_MESSAGE);
  });

  it("does not vary the message with the retry hint", () => {
    // Two inputs, one expected string. A message built by interpolation would
    // pass a single-input equality only by coincidence of the value chosen.
    expect(new CircuitOpenError(1).message).toBe(
      new CircuitOpenError(86_400).message,
    );
    expect(new CircuitOpenError(1).message).toBe(EXPECTED_CIRCUIT_OPEN_MESSAGE);
  });

  it("keeps its name and surfaces retryAfterS unchanged", () => {
    // `name` is what Sentry groups on and what several catch blocks branch on
    // after a structured-clone boundary has stripped the prototype.
    const err = new CircuitOpenError(30);
    expect(err.name).toBe("CircuitOpenError");
    expect(err.retryAfterS).toBe(30);
    expect(err).toBeInstanceOf(Error);
  });
});
