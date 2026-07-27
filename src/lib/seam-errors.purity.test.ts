import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as seamErrors from "./seam-errors";
import { CircuitOpenError, SeamBodyReadError } from "./seam-errors";

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
 * Two members. This is deliberately a set and not a lower bound: plan 140.2-05
 * added `SeamBodyReadError` and had to EDIT this literal to do it, which is
 * precisely the conscious decision the pin exists to force — the same shape as
 * the frozen four-path lint allowlist and the same shape as the budget-key
 * binding roster. The redness that edit produced was the pin working.
 */
const EXPECTED_EXPORTS: string[] = ["CircuitOpenError", "SeamBodyReadError"];

/**
 * `CircuitOpenError`'s message, typed HERE as a literal (threat T-140-05).
 *
 * `verify-strategy` is the unauthenticated landing-page teaser and it reaches
 * the seam, so this string is reachable by an anonymous caller. It must carry
 * no upstream URL, no header name, no Python traceback and no request detail.
 */
const EXPECTED_CIRCUIT_OPEN_MESSAGE = "Analytics service circuit is open";

/**
 * `SeamBodyReadError`'s message, typed HERE as a literal (threat T-140-05).
 *
 * Same reachability argument as above: the body-read failure this class reports
 * happens on the public teaser's own seam call, so the string an anonymous
 * caller can end up reading must carry no upstream URL, no header name, no
 * status and no transport detail. The original rejection travels as `cause`,
 * which is logged server-side and never rendered.
 */
const EXPECTED_BODY_READ_MESSAGE =
  "Analytics service response body could not be read";

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

/**
 * Phase 140.2-11 / SEAMCORE-11 (A-15) — `retryAfterS` is REFUSED at construction.
 *
 * The asymmetry this closes: `AnalyticsUpstreamError`, sixty lines away in
 * `analytics-client.ts`, `RangeError`s on a malformed HTTP status because that
 * value is forwarded as a response code. `CircuitOpenError`'s value is forwarded
 * as a `Retry-After` HEADER — to callers including the anonymous
 * verify-strategy teaser — and accepted anything. `new CircuitOpenError(NaN)`
 * put the literal bytes `Retry-After: NaN` on the wire.
 *
 * WHY REFUSE RATHER THAN CLAMP. The value comes from a store read
 * (`isBreakerOpen` → `Math.ceil((lock.expiresAtMs - now) / 1000)`, an encoded
 * expiry since plan 140.2-07). A clamp to 0 or to `DEFAULT_RETRY_AFTER_S` would
 * publish a plausible header and leave the broken expiry read looking like a
 * working one — permanently invisible, because nothing downstream can tell a
 * clamped value from a real one.
 *
 * ORACLE INDEPENDENCE: every invalid shape below is hand-typed, and the
 * assertion is the THROW, not merely that a valid value still works. A test that
 * only exercised the happy path would stay green with the validation deleted,
 * which is exactly the asserted-not-observed shape row M58 exists to falsify.
 */
describe("[SEAMCORE-11 / A-15] CircuitOpenError refuses a malformed retryAfterS", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["a negative number", -1],
    ["a fractional number", 12.5],
    ["a numeric string", "30"],
    ["undefined", undefined],
    ["null", null],
  ] as [string, unknown][])(
    "refuses %s at construction rather than publishing it as Retry-After",
    (_label, value) => {
      expect(
        () => new CircuitOpenError(value as number),
        "CircuitOpenError accepted a retryAfterS it cannot honestly publish. " +
          "The value is stringified straight into a Retry-After header by both " +
          "seam clients, so a malformed one reaches the wire — including an " +
          "anonymous teaser caller — and the broken store read that produced it " +
          "stays invisible.",
      ).toThrow(RangeError);
    },
  );

  it("names the offending value so the broken caller is findable", () => {
    expect(() => new CircuitOpenError(NaN)).toThrow(/invalid retryAfterS/i);
  });

  it("does NOT clamp — a broken expiry read must not look like a working one", () => {
    // The falsifier for the tempting alternative fix. If the constructor
    // silently substituted 0 or DEFAULT_RETRY_AFTER_S, `constructed` would be a
    // usable instance and nothing anywhere would ever report the fault.
    let constructed: CircuitOpenError | null = null;
    try {
      constructed = new CircuitOpenError(NaN);
    } catch {
      /* expected — see the assertion below */
    }
    expect(constructed).toBeNull();
  });

  it("constructs every valid value unchanged, message and name untouched", () => {
    // 0 is legal delta-seconds ("retry now"); 86_400 is far above any cooldown
    // this seam sets. Production only ever passes a positive integer
    // (`Math.ceil` over a strictly-future expiry, or DEFAULT_RETRY_AFTER_S).
    for (const valid of [0, 1, 30, 86_400]) {
      const err = new CircuitOpenError(valid);
      expect(err.retryAfterS).toBe(valid);
      expect(err.message).toBe(EXPECTED_CIRCUIT_OPEN_MESSAGE);
      expect(err.name).toBe("CircuitOpenError");
      expect(err).toBeInstanceOf(Error);
    }
  });
});

describe("[SEAMCORE-02 / T-140-05] SeamBodyReadError leaks nothing", () => {
  it("carries the static message, byte-for-byte, whatever the cause said", () => {
    // Two DIFFERENT causes, one expected string. A message that interpolated
    // the transport error would pass a single-input equality by coincidence of
    // the cause chosen — and would publish `TypeError: fetch failed reading
    // https://<railway-host>/…` to an anonymous teaser caller.
    const fromTimeout = new SeamBodyReadError(
      true,
      new DOMException("aborted", "TimeoutError"),
    );
    const fromNetwork = new SeamBodyReadError(
      false,
      new TypeError("terminated: other side closed"),
    );
    expect(
      fromTimeout.message,
      "SeamBodyReadError's message changed. It is reachable by the ANONYMOUS " +
        "verify-strategy teaser, so it must stay a static infrastructure " +
        "statement: no upstream URL, no header name, no status, no traceback. " +
        "The diagnosable half is the server log and `cause`, neither rendered.",
    ).toBe(EXPECTED_BODY_READ_MESSAGE);
    expect(fromNetwork.message).toBe(EXPECTED_BODY_READ_MESSAGE);
    expect(fromTimeout.message).toBe(fromNetwork.message);
  });

  it("keeps its name, its deadlineExceeded flag and its cause", () => {
    // `deadlineExceeded` is the ONLY thing the two clients branch on to reach
    // their EXISTING envelopes (504 vs 502, AnalyticsTimeoutError vs "not
    // reachable"). If it stopped being carried, every body-read failure would
    // collapse into one of the two and the distinction would vanish silently.
    const cause = new DOMException("aborted", "TimeoutError");
    const err = new SeamBodyReadError(true, cause);
    expect(err.name).toBe("SeamBodyReadError");
    expect(err.deadlineExceeded).toBe(true);
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
    expect(new SeamBodyReadError(false, cause).deadlineExceeded).toBe(false);
  });
});
