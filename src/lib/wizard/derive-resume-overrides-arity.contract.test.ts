/**
 * Phase 164.2.1 / SESSIONID-FENCE — EVERY PRODUCTION CALL OF
 * `deriveWizardResumeOverrides` PASSES ITS KEY ARGUMENT.
 *
 * THE PROPERTY, and why a type cannot express it. The function's fourth
 * parameter, `incomingApiKeyId`, defaults to `null` — and `null` is the
 * PERMISSIVE value: `sessionKeyMatches` returns true for it, so an omitted
 * argument DISABLES the fence for that call site. That is a fail-open default.
 * A future production caller that forgets the argument therefore compiles
 * cleanly, runs cleanly, restores an abandoned key-A session id under key B, and
 * nothing in the suite goes red — the failure is silent in exactly the way this
 * phase exists to remove.
 *
 * ⛔ MAKING THE PARAMETER REQUIRED IS NOT AVAILABLE, and it is worth recording
 * why rather than leaving the obvious fix looking un-considered: the phase's
 * success criterion 5 requires the ~25 existing three-argument unit pins to pass
 * UNMODIFIED, which is what proves the default did not change the gate's
 * behaviour for a caller that makes no key claim. Making it required would edit
 * every one of them and destroy that evidence. The default stays; this guard is
 * what stops it becoming a hole on the PRODUCTION side, where the fence is real.
 *
 * SO THE POPULATION IS SPLIT ON PURPOSE. Test files may (and do) call the
 * function with three arguments — that is the D-01 contract being exercised.
 * PRODUCTION files may not. The guard scans only the latter.
 *
 * ROW 1 — THE POPULATION IS DERIVED FROM DISK on every run, so a call site added
 * tomorrow in a file nobody thought of is covered without editing this file.
 * Nothing here is a hand-typed list of call sites.
 *
 * ⚠️ COMMENT-STRIPPED, via `stripCommentsPreserveLines`. This repo's prose is
 * dense with the function's NAME — `WizardClient.tsx` alone mentions it in four
 * comments, and `localStorage.ts` in two — so a raw grep would count paragraphs
 * as call sites and report an arity of zero for each. That is DEF-16-2 (grep is
 * comment-blind) landing inside the guard itself, and the stripper is what
 * prevents it. The both-polarity self-tests below pin that behaviour, INCLUDING
 * the specimen where a three-argument call appears inside a comment and must NOT
 * be counted.
 *
 * ⛔ ANTI-VACUITY. Two ways this guard could pass while measuring nothing, both
 * fenced: (a) the scanner finds no call sites at all — a rename, a moved file, a
 * broken walk — so the population size is asserted to be at least one; (b) the
 * arity counter always answers 4 — so it is exercised against synthetic sources
 * whose correct answers are 3, 4 and 5, including nested calls, object
 * literals, arrays and a comma inside a string.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const SYMBOL = "deriveWizardResumeOverrides";

/** Test files are the DELIBERATE exception — see the docblock. */
function isTestFile(path: string): boolean {
  return (
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.endsWith(".spec.ts") ||
    path.endsWith(".spec.tsx")
  );
}

function isProductionSource(path: string): boolean {
  return (
    (path.endsWith(".ts") || path.endsWith(".tsx")) &&
    !path.endsWith(".d.ts") &&
    !isTestFile(path)
  );
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (isProductionSource(full)) out.push(full);
  }
  return out;
}

interface CallSite {
  file: string;
  /** 1-based line of the opening `(`. */
  line: number;
  argCount: number;
}

/**
 * Count the TOP-LEVEL arguments of the call whose `(` sits at `openIndex`.
 *
 * Written as a bracket-depth scan rather than a regex because the real call site
 * spans five lines and a future one may nest a call, an object literal or an
 * array inside an argument — every one of which contains commas that are NOT
 * argument separators. String and template-literal bodies are skipped for the
 * same reason.
 *
 * ⚠️ A TRAILING COMMA IS NOT AN ARGUMENT. Prettier formats the real multi-line
 * call site with one, so a scanner that counted separators + 1 unconditionally
 * would score the correct call as 5 and fail a clean tree — measured, not
 * predicted: it did, on the first run of this guard. `seenSinceSep` is what
 * distinguishes `f(a, b,)` from `f(a, b, c)`.
 *
 * Returns `null` when the parentheses never balance (a truncated or malformed
 * source), which the caller reports as a failure rather than silently scoring 0.
 */
function countTopLevelArgs(src: string, openIndex: number): number | null {
  let depth = 0;
  /** Top-level separators seen so far. */
  let separators = 0;
  /** Has any non-space token appeared since the open paren or the last separator? */
  let seenSinceSep = false;
  let quote: string | null = null;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      seenSinceSep = true;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth > 1) seenSinceSep = true;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        // Closing the call itself. `f()` → 0; `f(a)` → 1; `f(a, b,)` → 2.
        return seenSinceSep ? separators + 1 : separators;
      }
      seenSinceSep = true;
      continue;
    }
    if (ch === "," && depth === 1) {
      separators++;
      seenSinceSep = false;
      continue;
    }
    if (!/\s/.test(ch)) seenSinceSep = true;
  }
  return null;
}

/**
 * Find every CALL of `SYMBOL` in already-comment-stripped source.
 *
 * A declaration (`function deriveWizardResumeOverrides(`) and an import
 * specifier are not calls. The declaration is excluded by requiring that the
 * token is not preceded by `function ` / `export function `; an import specifier
 * is excluded because it is never followed by `(`.
 */
function findCallSites(stripped: string): { index: number; line: number }[] {
  const hits: { index: number; line: number }[] = [];
  const re = new RegExp(`\\b${SYMBOL}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const before = stripped.slice(Math.max(0, m.index - 40), m.index);
    if (/\bfunction\s+$/.test(before)) continue;
    const openIndex = m.index + m[0].length - 1;
    const line = stripped.slice(0, m.index).split("\n").length;
    hits.push({ index: openIndex, line });
  }
  return hits;
}

function productionCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const file of walk(join(REPO_ROOT, "src"))) {
    const raw = readFileSync(file, "utf-8");
    if (!raw.includes(SYMBOL)) continue;
    const stripped = stripCommentsPreserveLines(raw, "ts");
    for (const hit of findCallSites(stripped)) {
      const argCount = countTopLevelArgs(stripped, hit.index);
      sites.push({
        file: relative(REPO_ROOT, file),
        line: hit.line,
        argCount: argCount ?? -1,
      });
    }
  }
  return sites;
}

describe(`[164.2.1 / SESSIONID-FENCE] ${SYMBOL} — production arity contract`, () => {
  it("finds at least one production call site (the guard is not scanning nothing)", () => {
    // Fence (a) from the docblock. A rename, a moved file or a broken walk would
    // otherwise make every assertion below hold over an empty set.
    expect(
      productionCallSites().length,
      `No production call of ${SYMBOL} was found. Either the symbol was renamed ` +
        `(update SYMBOL here) or the scan is broken — in both cases this guard ` +
        `is measuring nothing and must not be left green.`,
    ).toBeGreaterThanOrEqual(1);
  });

  it("every production call site passes all FOUR arguments", () => {
    const offenders = productionCallSites().filter((s) => s.argCount !== 4);
    expect(
      offenders,
      `A production call of ${SYMBOL} omits an argument. The 4th, ` +
        `\`incomingApiKeyId\`, DEFAULTS TO \`null\`, and \`null\` is the ` +
        `PERMISSIVE value — omitting it silently disables the key fence for ` +
        `that call site with no type error and no other failing test. Pass the ` +
        `key this mount will submit under, or a LITERAL \`null\` where the ` +
        `branch provably carries none (the CSV branch). Offenders: ` +
        JSON.stringify(offenders),
    ).toEqual([]);
  });

  /**
   * BOTH-POLARITY SELF-TESTS — fence (b). The arity counter and the call-site
   * finder are exercised against sources whose correct answers are known, so a
   * counter that always answered 4 (or a finder that matched nothing) fails here
   * rather than passing the two assertions above for the wrong reason.
   */
  describe("self-test — the scanner can distinguish the cases it claims to", () => {
    const arity = (src: string): number[] => {
      const stripped = stripCommentsPreserveLines(src, "ts");
      return findCallSites(stripped).map(
        (h) => countTopLevelArgs(stripped, h.index) ?? -1,
      );
    };

    it("counts a THREE-argument call as 3 (the shape this guard must reject)", () => {
      expect(arity(`const o = ${SYMBOL}(loaded, source, draftId);`)).toEqual([3]);
    });

    it("counts the real four-argument shape as 4", () => {
      expect(
        arity(
          `const o = ${SYMBOL}(\n  loaded,\n  source,\n  initialDraft?.id ?? null,\n  incomingApiKeyId,\n);`,
        ),
      ).toEqual([4]);
    });

    it("is not fooled by commas nested inside arguments", () => {
      // Nested call, object literal, array and a comma inside a string — four
      // separate ways a naive comma count would over-report.
      expect(
        arity(
          `${SYMBOL}(pick(a, b), { x: 1, y: 2 }, [p, q], "a,b,c");`,
        ),
      ).toEqual([4]);
    });

    it("counts a FIVE-argument call as 5 (the counter is not pinned to 4)", () => {
      expect(arity(`${SYMBOL}(a, b, c, d, e);`)).toEqual([5]);
    });

    it("does not count a TRAILING COMMA as an argument", () => {
      // The shape prettier actually produces at the real call site. Before this
      // was handled, the counter scored the correct four-argument call as 5 and
      // the production assertion failed on a clean tree.
      expect(arity(`${SYMBOL}(a, b, c, d,);`)).toEqual([4]);
      expect(arity(`${SYMBOL}(\n  a,\n  b,\n  c,\n  d,\n);`)).toEqual([4]);
    });

    it("counts a no-argument call as 0", () => {
      expect(arity(`${SYMBOL}();`)).toEqual([0]);
    });

    it("ignores a call that appears inside a COMMENT (DEF-16-2)", () => {
      // The specimen. This repo really does discuss the function in prose beside
      // its call site, so a comment-blind scan would report a bogus offender —
      // or, worse, an arity of 3 for a paragraph and fail a clean tree.
      expect(
        arity(`// see ${SYMBOL}(loaded, source, draftId) above\nconst x = 1;`),
      ).toEqual([]);
      expect(
        arity(`/**\n * ${SYMBOL}(a, b, c)\n */\nconst x = 1;`),
      ).toEqual([]);
    });

    it("ignores the DECLARATION, which is not a call", () => {
      expect(
        arity(
          `export function ${SYMBOL}(\n  loaded: X,\n  source: Y,\n  id: string | null,\n  key: string | null = null,\n): Z {}`,
        ),
      ).toEqual([]);
    });

    it("still counts a real call in a file that ALSO declares it", () => {
      // Guards against an over-broad declaration filter silently swallowing
      // every call in the defining module.
      expect(
        arity(
          `export function ${SYMBOL}(a: A, b: B, c: C, d: D = null) {}\n` +
            `const o = ${SYMBOL}(w, x, y, z);`,
        ),
      ).toEqual([4]);
    });
  });
});
