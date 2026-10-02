// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

/**
 * ⭐ 161-06 / WIZERR-05 — EVERY LOCAL `AnalyticsUpstreamError` DOUBLE MATCHES
 * THE REAL CLASS'S CONSTRUCTOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS LAW EXISTS
 *
 * A change to the real class in `src/lib/analytics-client.ts` CANNOT fail a
 * locally-redeclared double. Five route test files declare their own
 * `class AnalyticsUpstreamError extends Error` inside a
 * `vi.mock("@/lib/analytics-client", …)` factory — they have to, because the
 * factory replaces the module wholesale and the route's own `instanceof` must
 * resolve against a real constructor. So when the real class grows a parameter,
 * those five do not go red. They go SILENT. The drift is invisible by
 * construction, and it stays invisible until someone writes a test that passes
 * the new argument positionally and gets it read as the previous parameter.
 *
 * THIS HAS ALREADY HAPPENED TWICE, and the doubles themselves record it. The
 * simulator double's comment reads: the third arg was added "mirroring the real
 * class… so the 4xx-forward arm's `err.seamCode ?? \"UNKNOWN\"` is falsifiable
 * here." That precedent is correct — and it was held by CONVENTION alone. Four
 * of the five picked up `seamCode` when 140.3 added it; NONE of the five picked
 * up `dependency` when 140.3-11 added it, and one (`verify-strategy`) never
 * picked up `seamCode` either. Measured at HEAD, before this file existed.
 *
 * The concrete hazard is positional, not cosmetic. With the real class at
 * `(message, status, seamCode, dependency, retryAfterSeconds)` and a double at
 * `(message, status, seamCode)`, a construction
 * `new AnalyticsUpstreamError(m, 503, "CODE", 30)` reads `30` as the WAIT in
 * the double and as the DEPENDENCY NAME in production. The test is green, the
 * route is wrong, and nothing anywhere says so. This file is what makes that a
 * failure instead of a convention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORACLE INDEPENDENCE (the rule this file must not break)
 *
 * A derivation may NEVER be its own oracle. Two independent hand-typed literals
 * are the fence:
 *
 *   - `REAL_CTOR_PARAMS` — the real class's parameter list, typed out here, in
 *     order. The parity check compares each double against THIS, and the real
 *     class is separately asserted to match it. So a parameter added to the real
 *     class without a deliberate edit to this file reds immediately, before any
 *     double is even consulted.
 *   - `EXPECTED_DOUBLE_FILES` / `EXPECTED_DOUBLE_COUNT` — the population,
 *     hand-typed from a measurement (see the predicate below). NEVER
 *     `derived.length`: a scanner that silently stopped matching would make an
 *     empty population satisfy every parity assertion vacuously, which is the
 *     shape "a test that cannot fail" takes when it is written carelessly.
 *
 * THE SCANNER PREDICATE, IN PROSE, so the count above is reproducible without
 * reading the regex: every file under `src/` whose extension is `.ts` or `.tsx`,
 * read from disk and comment-stripped, that contains a class declaration of the
 * form `class AnalyticsUpstreamError extends Error {`. `src/lib/analytics-client.ts`
 * — the one real, exported declaration — is excluded and becomes the reference.
 * Everything else is a double. Measured 2026-08-24 by
 * `grep -ran "class AnalyticsUpstreamError" src`: six hits, one real, five
 * doubles.
 *
 * ⚠️ `grep -a`, not bare `grep`. `src/lib/wizardErrors.test.ts` carries a
 * deliberate NUL byte (a load-bearing phrase delimiter), and a bare `grep`
 * SKIPS that file in silence — which reads exactly like "no match". This law is
 * unaffected either way: it reads source through `readFileSync`, which has no
 * such blind spot.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_ROOT = join(REPO_ROOT, "src");
const REAL_CLASS_FILE = "src/lib/analytics-client.ts";

/**
 * The real class's constructor parameters, HAND-TYPED, in declaration order.
 *
 * This is the oracle for both halves of the law: the real class is asserted to
 * match it, and every double is asserted to match it. Growing the real class
 * therefore costs two deliberate edits — the class, and this literal. That
 * friction IS the mechanism.
 *
 * ⚠️ If a SIXTH parameter, or a second `number | null` one, ever appears here,
 * the positional add-alongside form has run out of type-distinctness and the
 * trailing-options-object refactor becomes mandatory (161-06's recorded
 * assumption-delta trigger). Do not simply extend this array past that point.
 */
const REAL_CTOR_PARAMS = [
  "message",
  "status",
  "seamCode",
  "dependency",
  "retryAfterSeconds",
] as const;

/**
 * The five files declaring a double, HAND-TYPED from the measurement above,
 * sorted. Naming them rather than counting them is what makes a failure say
 * WHICH file appeared or disappeared.
 */
const EXPECTED_DOUBLE_FILES = [
  "src/app/api/bridge/route.test.ts",
  "src/app/api/keys/validate-and-encrypt/route.test.ts",
  "src/app/api/scenario/optimize/route.test.ts",
  "src/app/api/simulator/route.test.ts",
  "src/app/api/verify-strategy/route.test.ts",
] as const;

/** Hand-typed, and asserted INDEPENDENTLY of the list above. */
const EXPECTED_DOUBLE_COUNT = 5;

/**
 * Blank the CONTENTS of every string and template literal, preserving length.
 *
 * The brace- and paren-balancing below must not be defeated by punctuation
 * inside a string — the real class's `RangeError` message contains both parens
 * and a `${…}` interpolation. `stripCommentsPreserveLines` deliberately leaves
 * string contents intact (a `//` inside a string is not a comment), so this is
 * the complementary pass, and it is applied SECOND.
 */
function maskStringContents(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < out.length) {
        if (out[i] === "\\") {
          out[i] = " ";
          if (i + 1 < out.length && out[i + 1] !== "\n") out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (out[i] === quote) break;
        if (out[i] !== "\n") out[i] = " ";
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Scan forward from an opening delimiter to its match, returning its index. */
function matchDelimiter(source: string, openIndex: number): number {
  const open = source[openIndex];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a parameter list on TOP-LEVEL commas only. */
function splitTopLevel(params: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of params) {
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}" || ch === ">") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter((p) => p.trim() !== "");
}

const PARAM_NAME = /^\s*(?:readonly\s+|public\s+|private\s+|protected\s+)*([A-Za-z_$][\w$]*)/;
const CLASS_DECL = /\bclass\s+AnalyticsUpstreamError\s+extends\s+Error\s*\{/g;

export interface UpstreamErrorDeclaration {
  /** Constructor parameter names, in declaration order. */
  params: string[];
  /** Parameter names for which the body assigns `this.<name> = …`. */
  assignedFields: string[];
}

/**
 * Parse every `class AnalyticsUpstreamError extends Error { … }` declaration in
 * a source string. Comments are stripped and string contents masked FIRST, so a
 * declaration written out in prose is not a declaration.
 */
export function parseUpstreamErrorDeclarations(
  source: string,
): UpstreamErrorDeclaration[] {
  const clean = maskStringContents(stripCommentsPreserveLines(source, "ts"));
  const found: UpstreamErrorDeclaration[] = [];
  CLASS_DECL.lastIndex = 0;
  let decl: RegExpExecArray | null;
  while ((decl = CLASS_DECL.exec(clean)) !== null) {
    const bodyOpen = clean.indexOf("{", decl.index);
    const bodyClose = matchDelimiter(clean, bodyOpen);
    if (bodyClose === -1) continue;
    const body = clean.slice(bodyOpen, bodyClose + 1);

    const ctorAt = body.indexOf("constructor");
    if (ctorAt === -1) {
      found.push({ params: [], assignedFields: [] });
      continue;
    }
    const parenOpen = body.indexOf("(", ctorAt);
    const parenClose = matchDelimiter(body, parenOpen);
    const params = splitTopLevel(body.slice(parenOpen + 1, parenClose))
      .map((p) => PARAM_NAME.exec(p)?.[1])
      .filter((n): n is string => typeof n === "string");

    const assignedFields = params.filter((name) =>
      new RegExp(`this\\.${name}\\s*=`).test(body),
    );
    found.push({ params, assignedFields });
  }
  return found;
}

/** Every `.ts` / `.tsx` file under `src/`, as repo-relative POSIX paths. */
function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      allSourceFiles(full, acc);
      continue;
    }
    if (/\.tsx?$/.test(entry)) acc.push(relative(REPO_ROOT, full).split(sep).join("/"));
  }
  return acc;
}

const DECLARING_FILES = allSourceFiles(SRC_ROOT)
  .filter(
    (path) =>
      parseUpstreamErrorDeclarations(readFileSync(join(REPO_ROOT, path), "utf8"))
        .length > 0,
  )
  .sort();

const DOUBLE_FILES = DECLARING_FILES.filter((p) => p !== REAL_CLASS_FILE);

describe("[161-06 / WIZERR-05] AnalyticsUpstreamError doubles are ctor-compatible with the real class", () => {
  describe("SELF-TEST — the scanner is not answering by accident", () => {
    it("POSITIVE: finds a declaration written in the real form, with its params and fields", () => {
      const snippet = `
        vi.mock("@/lib/analytics-client", () => {
          class AnalyticsUpstreamError extends Error {
            readonly status: number;
            readonly seamCode: string | null;
            constructor(
              message: string,
              status: number,
              seamCode: string | null = null,
            ) {
              super(message);
              this.name = "AnalyticsUpstreamError";
              this.status = status;
              this.seamCode = seamCode;
            }
          }
          return { AnalyticsUpstreamError };
        });
      `;
      const found = parseUpstreamErrorDeclarations(snippet);
      expect(found).toHaveLength(1);
      expect(found[0].params).toEqual(["message", "status", "seamCode"]);
      expect(found[0].assignedFields).toEqual(["status", "seamCode"]);
    });

    it("NEGATIVE: a declaration that exists only inside a COMMENT is not counted", () => {
      const snippet = `
        // class AnalyticsUpstreamError extends Error {
        //   constructor(message: string, status: number) { super(message); }
        // }
        /**
         * class AnalyticsUpstreamError extends Error {
         *   constructor(message: string, status: number, seamCode: string) {}
         * }
         */
        const nothingHere = 1;
      `;
      expect(
        parseUpstreamErrorDeclarations(snippet),
        "Prose describing the class must not satisfy the guard. Without the " +
          "comment strip, every docblock in this repo that discusses the " +
          "constructor would enlarge the population and dilute the law.",
      ).toEqual([]);
    });

    it("NEGATIVE: a declaration inside a STRING literal is not counted either", () => {
      const snippet =
        'const example = "class AnalyticsUpstreamError extends Error { constructor(m: string) {} }";';
      expect(parseUpstreamErrorDeclarations(snippet)).toEqual([]);
    });
  });

  describe("the population is real, and it is the measured one", () => {
    it("is NOT empty — an empty-set law passes trivially and guards nothing", () => {
      expect(
        DOUBLE_FILES.length,
        "The scanner found no local doubles at all. Either every one was " +
          "deleted (in which case delete this law deliberately) or the " +
          "scanner broke — and a broken scanner makes every parity assertion " +
          "below pass vacuously.",
      ).toBeGreaterThan(0);
    });

    it("has exactly the hand-typed measured size", () => {
      expect(
        DOUBLE_FILES.length,
        "The number of files declaring their own AnalyticsUpstreamError " +
          "changed. That is not a thing to 'fix' by editing the literal: a " +
          "SIXTH double is a sixth place a constructor change can go silent, " +
          "and it needs the same deliberate decision the other five got.",
      ).toBe(EXPECTED_DOUBLE_COUNT);
    });

    it("is exactly the hand-typed roster, by path", () => {
      expect(DOUBLE_FILES).toEqual([...EXPECTED_DOUBLE_FILES]);
    });

    it("the REAL class is where this law thinks it is", () => {
      expect(DECLARING_FILES).toContain(REAL_CLASS_FILE);
    });
  });

  describe("the reference itself", () => {
    const real = parseUpstreamErrorDeclarations(
      readFileSync(join(REPO_ROOT, REAL_CLASS_FILE), "utf8"),
    );

    it("the real class parses to exactly ONE declaration", () => {
      expect(real).toHaveLength(1);
    });

    it("its constructor matches the hand-typed reference list, in order", () => {
      expect(
        real[0].params,
        "The real class's constructor moved. Update REAL_CTOR_PARAMS above — " +
          "and then update all five doubles, which is the whole reason this " +
          "file exists. ⚠️ A sixth parameter, or a second `number | null` " +
          "one, means the positional form is out of type-distinctness and the " +
          "trailing-options-object refactor is owed instead.",
      ).toEqual([...REAL_CTOR_PARAMS]);
    });

    it("it assigns a field for every parameter except `message` (which goes to super)", () => {
      expect(real[0].assignedFields).toEqual(
        REAL_CTOR_PARAMS.filter((p) => p !== "message"),
      );
    });

    it("every reference parameter name is a real identifier (the non-blank fence)", () => {
      // `"anything".includes("")` is true, and `[].every(…)` is true. Both are
      // ways an assertion below could hold while measuring nothing, so the
      // names are checked for substance before they are used as oracles.
      expect(REAL_CTOR_PARAMS.length).toBeGreaterThanOrEqual(2);
      for (const name of REAL_CTOR_PARAMS) {
        expect(name).toMatch(/^[A-Za-z_$][\w$]*$/);
      }
    });
  });

  describe("PARITY — each double declares the real constructor, in the real order", () => {
    it.each([...EXPECTED_DOUBLE_FILES])(
      "%s declares a ctor-compatible double",
      (path) => {
        const declarations = parseUpstreamErrorDeclarations(
          readFileSync(join(REPO_ROOT, path), "utf8"),
        );
        expect(declarations.length).toBeGreaterThan(0);

        for (const decl of declarations) {
          expect(
            decl.params.length,
            `${path}'s double declares ${decl.params.length} constructor ` +
              `parameters; the real class declares ${REAL_CTOR_PARAMS.length}. ` +
              "A double with fewer parameters cannot be made to carry the " +
              "field a route now reads, and — worse — a positional " +
              "construction silently means something different here than it " +
              "does in production.",
          ).toBeGreaterThanOrEqual(REAL_CTOR_PARAMS.length);

          expect(
            decl.params.slice(0, REAL_CTOR_PARAMS.length),
            `${path}'s double does not mirror the real constructor's ` +
              "parameter names in the real order. Same names, same order, or " +
              "a positional argument lands in a different field here than at " +
              "the seam.",
          ).toEqual([...REAL_CTOR_PARAMS]);

          expect(
            decl.assignedFields,
            `${path}'s double declares a parameter it never assigns to a ` +
              "field. A parameter the constructor accepts and drops is worse " +
              "than an absent one: the test reads `undefined` from a field it " +
              "believes it set.",
          ).toEqual(REAL_CTOR_PARAMS.filter((p) => p !== "message"));
        }
      },
    );
  });
});
