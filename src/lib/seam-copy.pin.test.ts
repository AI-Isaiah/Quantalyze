import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CIRCUIT_OPEN_COPY } from "./seam-copy";

/**
 * Phase 140.3 / SEAMUX-01 — the seam breaker copy has ONE production source,
 * and drift between any two production copies fails here.
 *
 * ⚠️ THE ONE RULE THAT MAKES THIS FILE WORK
 * -----------------------------------------
 * **No expectation in this file may be read out of the module under test.** The
 * expected sentence is typed HERE, by hand, character for character. A pin of
 * the shape `expect(<the module's export>).toBe(<the same module's export>)`
 * cannot fail, ever, by construction — it asserts that a value equals itself and
 * reads as coverage. That is the exact defect this file exists to invert, and
 * writing it here would be worse than writing nothing, because the row would
 * then be certified.
 *
 * WHY IT EXISTS — AND WHAT THE GAP ACTUALLY WAS
 * ---------------------------------------------
 * Ten production files declared this sentence independently, and **not one of
 * them exported it**. So nothing pinned any copy to any other: a route could be
 * reworded, its own test updated in the same commit, and the suite stayed green
 * while that route now differed from the other nine. The gap was
 * production↔production, and this file closes it in two directions at once —
 * the bytes are pinned to a literal, and no production file may re-declare them.
 *
 * ⚠️ WHAT THIS FILE MUST NOT GROW INTO. Twelve route test files re-declare this
 * sentence as their own hand-typed literal. Those are NOT defects. Nothing was
 * exported before this leaf existed, so those literals cannot have been reads of
 * the module under test — they are twelve independent oracles, and
 * `src/app/api/keys/sync/route.seam.test.ts` states the discipline out loud
 * ("Duplicated deliberately: a test that imported the constant from the client
 * could not detect it changing"). Pointing them at the leaf would collapse
 * twelve independent oracles into one self-referential one — TRAP-9, binding.
 * The scan below deliberately EXCLUDES every `.test.` file for that reason: this
 * guard polices production, and the twelve are the fence, not the defect.
 *
 * SCOPE. This file pins WHERE the bytes come from. It asserts nothing about the
 * five different envelope shapes the ten emitters wrap them in, or about the
 * fact that only two carry a `code` — that is envelope fragmentation, requirement
 * SEAMUX-03, owned by a later plan.
 */

/**
 * The breaker sentence, typed HERE as a literal.
 *
 * If a copy change is ever intended, this line changes in the SAME commit as
 * `src/lib/seam-copy.ts` and as the twelve route test literals — three edits, on
 * purpose. A copy change that only needs one edit is a copy change nothing can
 * detect.
 */
const EXPECTED_CIRCUIT_OPEN_COPY =
  "The analytics service is temporarily unavailable. Please try again in a moment.";

/**
 * Hand-typed. The ten production files that read the leaf.
 *
 * ⚠️ PINNED AS A LITERAL NUMBER, NEVER AS `discovered.length`. A count derived
 * from the discovered list is satisfied by ANY list, including one a site has
 * silently dropped out of — which is precisely the regression this number
 * exists to catch. Nine of the ten bind it as `CIRCUIT_OPEN_COPY`;
 * `src/lib/process-key-client.ts` binds it as `CIRCUIT_OPEN_HUMAN_MESSAGE`, so
 * an enumeration by SYMBOL finds nine and reports success. The enumeration is by
 * the STRING and by the import edge, never by the symbol.
 */
const EXPECTED_LEAF_CONSUMERS = 10;

const LEAF_PATH = "src/lib/seam-copy.ts";

/**
 * Strip comments before matching.
 *
 * ⚠️ THIS IS NOT COSMETIC. Every one of the ten emitters carries a docblock
 * discussing this copy, the leaf's own header discusses it at length, and this
 * programme has been bitten repeatedly by a guard satisfied by its own
 * explanatory prose. A bare `grep -c` is self-invalidating here.
 *
 * Block comments are blanked character-for-character so line numbers survive
 * into the failure message; a whole-line `//` becomes an empty line. Trailing
 * `//` comments are LEFT IN, which can only produce a false POSITIVE — the safe
 * direction for a guard whose job is to fail loud.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

/**
 * Every `.ts`/`.tsx` under `src/` that is production code: not a test, and not
 * the leaf itself.
 *
 * A SCAN and not a hand-typed roster, on purpose. The class is "every production
 * file that could declare this sentence", and the failure mode is a NEW member
 * appearing — a file nobody wrote a test for, because nobody knew it would exist.
 * A roster can only cover files it names; only a scan fails on one it has never
 * seen. (The `EXPECTED_LEAF_CONSUMERS` count above is the complementary half: the
 * scan catches an eleventh declaration, the literal count catches a tenth
 * disappearing.)
 */
function productionSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(process.cwd(), dir), {
      withFileTypes: true,
    })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
        if (rel !== LEAF_PATH) files.push(rel);
      }
    }
  };
  walk("src");
  return files;
}

const PRODUCTION_FILES = productionSourceFiles();

/** `import … from "@/lib/seam-copy"` — or the relative form, from inside `src/lib`. */
const LEAF_IMPORT = /from\s*["'](?:@\/lib\/seam-copy|\.\/seam-copy)["']/;

describe("[140.3-04 / SEAMUX-01] the breaker copy is pinned to a hand-typed literal", () => {
  it("the leaf's exported sentence is byte-identical to the literal typed in this file", () => {
    expect(
      CIRCUIT_OPEN_COPY,
      `The seam breaker copy changed. This is the ONE place it is pinned to ` +
        `bytes that were not read out of the module under test, so this ` +
        `assertion is the only thing standing between a reworded sentence and a ` +
        `green suite. If the change is intended, edit this literal, the leaf, ` +
        `and the twelve route test literals in the SAME commit — and check the ` +
        `new wording against DESIGN.md's Voice section, since the ` +
        `UNAUTHENTICATED teaser renders it directly (T-140-08): no upstream ` +
        `URL, no status, no cooldown vocabulary, and no blaming the user's key ` +
        `for an outage in which no request was ever issued.`,
    ).toBe(EXPECTED_CIRCUIT_OPEN_COPY);
  });

  it("the copy is a plain sentence, carrying no infrastructure detail", () => {
    // The negative half of T-140-05 / T-140-08 / T-140-17, asserted rather than
    // reviewed. Each banned token is a thing a well-meaning "more helpful error"
    // edit would add, and each is invisible to a byte-pin if the pin is updated
    // alongside — so this outlives the literal above.
    const BANNED = ["http", "railway", "circuit", "breaker", "5xx", "upstream"];
    const lower = CIRCUIT_OPEN_COPY.toLowerCase();
    expect(
      BANNED.filter((token) => lower.includes(token)),
      `The breaker copy names infrastructure. A trip is an infrastructure fact ` +
        `and the unauthenticated teaser renders this string directly, so it must ` +
        `carry no upstream URL, no host, no status and no cooldown vocabulary ` +
        `beyond the Retry-After header itself (T-140-08 / T-140-17).`,
    ).toEqual([]);
  });
});

describe("[140.3-04 / SEAMUX-01] no production file declares the seam copy locally", () => {
  it("the scanner actually reads production source (fail-loud on a broken scan)", () => {
    // A scanner that matched NOTHING would report the repo clean forever — the
    // failure mode that makes a source guard worse than no guard, because it
    // reads as protection. The bound is hand-typed and deliberately far below
    // the real figure so ordinary growth never touches it.
    expect(
      PRODUCTION_FILES.length,
      `The production-source scan found almost no files, so every assertion in ` +
        `this describe is vacuously true. Fix the walker before trusting it.`,
    ).toBeGreaterThan(200);
  });

  it("ZERO production files re-declare the sentence — the leaf is the only source", () => {
    // Comment-stripped before matching: the ten emitters' docblocks discuss this
    // copy by name, and an unstripped scan would report prose as a violation
    // (or, worse, a future editor would "fix" the guard by weakening it).
    const offenders = PRODUCTION_FILES.filter((file) =>
      stripComments(readFileSync(join(process.cwd(), file), "utf8")).includes(
        EXPECTED_CIRCUIT_OPEN_COPY,
      ),
    );

    expect(
      offenders,
      `These production files declare the seam breaker sentence locally instead ` +
        `of importing ${LEAF_PATH}. Ten files used to, none exported it, and ` +
        `nothing pinned any copy to any other — so one of them could be reworded ` +
        `with its own test updated alongside and the suite stayed green while it ` +
        `now differed from the other nine. Import the leaf; do not re-declare ` +
        `the bytes. (Test files are excluded from this scan on purpose: their ` +
        `twelve hand-typed literals are independent oracles and must NOT be ` +
        `consolidated onto the leaf — TRAP-9.)`,
    ).toEqual([]);
  });

  it("EXACTLY ten production files import the leaf — pinned to a literal count", () => {
    const consumers = PRODUCTION_FILES.filter((file) =>
      LEAF_IMPORT.test(
        stripComments(readFileSync(join(process.cwd(), file), "utf8")),
      ),
    );

    expect(
      consumers.length,
      `The number of production files reading the seam copy leaf changed. ` +
        `Expected ${EXPECTED_LEAF_CONSUMERS}, found ${consumers.length}:\n` +
        `${consumers.join("\n")}\n\n` +
        `A DROP means an emitter stopped reading the one source — usually ` +
        `because its breaker arm was deleted or its copy was re-inlined, and the ` +
        `sibling assertion above only catches the second of those. A RISE means ` +
        `a new seam emitter appeared: that is fine, but it is a decision to ` +
        `record by bumping this literal in the same commit, which is the point ` +
        `of pinning a number instead of asserting the list's own length.`,
    ).toBe(EXPECTED_LEAF_CONSUMERS);
  });
});
