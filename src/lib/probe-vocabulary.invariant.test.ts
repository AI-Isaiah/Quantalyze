// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";
import { CIRCUIT_OPEN_COPY } from "./seam-copy";

/**
 * 161-01 / WIZERR-04 — THE `keys/[id]/permissions` PRIVATE CODE VOCABULARY IS A
 * POPULATION, NOT A LIST SOMEONE REMEMBERED TO UPDATE.
 *
 * ── WHAT THIS EXISTS TO STOP ────────────────────────────────────────────────
 *
 * This route classifies every probe failure into a PRIVATE vocabulary of its
 * own (`PROBE_*` plus two borrowed codes) and pairs each code with a curated
 * user-facing sentence. Nothing held the pairing. `KEY_UNDECRYPTABLE` is the
 * proof: the upstream classified the fault, the route carried the code on the
 * thrown error's `cause` from 140.3-01 onward, and the terminal arm never
 * consulted it — so a permanently orphaned key was told "Could not check key
 * scopes. Try again." for four phases. A retry cannot clear that fault. The
 * sentence was not vague; it was FALSE, and it hid the one action that works.
 *
 * 161-01 fixed the instance. This law is what makes it a CLASS: the population
 * is derived from the route's source on every run, so the SEVENTH code — the
 * one nobody has written yet — fails here BY NAME on the day it is written,
 * and a deleted arm fails here on the day it is deleted.
 *
 * ── THE EMITTER PREDICATE, IN FULL PROSE (so the count is reproducible
 *    without reading a single regex) ─────────────────────────────────────────
 *
 * A member of the population is an UPPER_SNAKE string literal in the route's
 * COMMENT-STRIPPED source that occupies one of the TWO shapes this route
 * actually uses to emit a code to the client:
 *
 *   SHAPE A — a `code:` object property whose value is that string literal.
 *     This is the response-body form: `{ error: "…", code: "PROBE_RATE_LIMITED" }`.
 *     Measured 3 at the time of writing: CIRCUIT_OPEN, PROBE_RATE_LIMITED,
 *     KEY_UNDECRYPTABLE.
 *
 *   SHAPE B — a string literal on the right-hand side of a `const code = …;`
 *     assignment. This is the cascade's form: a nested ternary of BARE string
 *     literals, handed to the terminal response as the shorthand property
 *     `{ error: userMessage, code }`. Measured 3: PROBE_BACKEND_UNAVAILABLE,
 *     PROBE_TIMEOUT, PROBE_FAILED.
 *
 * Total measured at HEAD: **6**. Both counts are hand-typed below, never
 * `derived.length` — an assertion that compares a derivation to itself cannot
 * fail, which is the vacuity mechanism this repo has shipped four times in a
 * single day.
 *
 * ⚠️ WHY THIS LAW BRINGS ITS OWN SCANNER instead of reusing the incumbent
 * `wizardErrors.invariant.test.ts` emitter regex. Measured, not assumed: that
 * regex is written for CODE-FIRST envelope literals and would see NEITHER of
 * the two shapes above — this route's bodies are error-first, and half its
 * vocabulary never appears in an object literal at all. The alternative was to
 * restructure working, heavily-reasoned route arms so a scanner could see them.
 * That inverts the relationship: the guard exists to describe the code, not to
 * conscript it. (161-UI-SPEC's parenthetical "code-first-literal emitter shape
 * so the scanner sees it" assumed reuse of the incumbent regex; per that
 * document's own preamble the COPY and the INVARIANTS are the contract and the
 * mechanics are planner-adjustable. The copy and invariants are honoured
 * verbatim; only the mechanism differs, and both SELF-TESTs below prove the
 * substituted mechanism actually reads this route.)
 *
 * ⚠️ WHY THE CASCADE IS DELIBERATELY NOT SHARED with the repo-wide
 * `classifyKeyValidationError`, restated here so nobody "simplifies" this route
 * into it and deletes the vocabulary this law guards. The route's own docblock
 * records the measurement: routed through that classifier, FIVE of this route's
 * six real thrown messages fall to `{code:"UNKNOWN", status:500}` — the
 * terminal "our team has been notified" dead end — because it classifies
 * KEY-VALIDATION faults (signature / credentials / venue scopes) while every
 * fault reachable here is a PROXY-INFRASTRUCTURE fault. The sharing that
 * matters is already in place: the breaker verdict comes from the shared typed
 * `CircuitOpenError` and the ONE `CIRCUIT_OPEN_COPY`. The cascade gets a law,
 * not a deletion.
 *
 * ── DECLARED BLINDNESS — READ BEFORE TRUSTING THIS FILE ─────────────────────
 *
 * ⚠️ SOURCE, NOT BEHAVIOUR. Every assertion here reads text. That a code is
 * emitted with a curated sentence beside it does not prove the right arm fires
 * for the right fault — the behavioural cases in
 * `src/app/api/keys/[id]/permissions/route.test.ts` are where that lives. The
 * two tiers are complementary and neither substitutes for the other.
 *
 * ⚠️ ROW 2 IS HAND-MADE. Per the coverage-law rows: the POPULATION is derived
 * (row 1), the ROSTER below is hand-typed and its `retryClearsIt` judgment is a
 * human call (row 2). What the roster adds is strictly FAIL-LOUD ARRIVAL — a
 * roster that cannot silently miss a new member is still a roster.
 *
 * ⚠️ ORACLE INDEPENDENCE. Every sentence in the roster is a HAND-TYPED
 * transcription of the shipped copy. None is imported from the route. The one
 * import (`CIRCUIT_OPEN_COPY`) is asserted AGAINST a hand-typed transcription,
 * which is the opposite of self-reference: it is the pin that reddens if the
 * shared constant's text moves under this route.
 */

const ROUTE_REL = "src/app/api/keys/[id]/permissions/route.ts";

// ---------------------------------------------------------------------------
// PART 0 — the scanner. One comment handler (140.5-01's `source-scan.ts`), so a
// tokenizer fix reaches this law too.
// ---------------------------------------------------------------------------

function readStripped(relPath: string): string {
  return stripCommentsPreserveLines(
    readFileSync(join(process.cwd(), relPath), "utf8"),
    "ts",
  );
}

/** SHAPE A — the response-body form: `code: "SOMETHING"`. */
const CODE_PROPERTY = /\bcode:\s*"([A-Z][A-Z0-9_]*)"/g;

/**
 * SHAPE B — the whole right-hand side of a `const code = …;` assignment.
 * `[^;]*` is correct and deliberate rather than lazy: the cascade's ternary
 * contains no semicolon, so the first `;` is genuinely its terminator, and a
 * non-greedy `[\s\S]*?;` would behave identically while reading worse.
 */
const CODE_ASSIGNMENT = /\bconst\s+code\s*=\s*([^;]*);/g;

/** An UPPER_SNAKE string literal, used only INSIDE an already-matched shape. */
const UPPER_SNAKE_LITERAL = /"([A-Z][A-Z0-9_]*)"/g;

function scanShapeA(src: string): string[] {
  return [...src.matchAll(CODE_PROPERTY)].map((m) => m[1]);
}

function scanShapeB(src: string): string[] {
  return [...src.matchAll(CODE_ASSIGNMENT)].flatMap((m) =>
    [...m[1].matchAll(UPPER_SNAKE_LITERAL)].map((lit) => lit[1]),
  );
}

function scanEmittedCodes(src: string): string[] {
  return [...new Set([...scanShapeA(src), ...scanShapeB(src)])].sort();
}

// ---------------------------------------------------------------------------
// PART 1 — the DERIVED population.
// ---------------------------------------------------------------------------

const ROUTE_SRC = readStripped(ROUTE_REL);
const ROUTE_SRC_RAW = readFileSync(join(process.cwd(), ROUTE_REL), "utf8");

const SHAPE_A_CODES = scanShapeA(ROUTE_SRC);
const SHAPE_B_CODES = scanShapeB(ROUTE_SRC);
const EMITTED_CODES = scanEmittedCodes(ROUTE_SRC);

/**
 * HAND-TYPED MEASURED COUNTS. Never `EMITTED_CODES.length` — that is the
 * derivation certifying itself. Re-measure by hand when an arm is added or
 * removed, and move these numbers deliberately.
 */
const EXPECTED_TOTAL_CODES = 6;
const EXPECTED_SHAPE_A_SITES = 3;
const EXPECTED_SHAPE_B_SITES = 3;

// ---------------------------------------------------------------------------
// PART 2 — the hand-typed ROSTER (row 2). Code → the curated sentence the user
// actually reads, plus the human judgment that makes the sentence honest.
// ---------------------------------------------------------------------------

interface RosterEntry {
  /** The curated sentence, HAND-TYPED from the shipped copy. Never imported. */
  sentence: string;
  /**
   * Does trying again clear THIS fault, unaided? The whole phase turns on this
   * question: "Try again" is legitimate copy exactly when the answer is yes,
   * and a lie when it is no.
   */
  retryClearsIt: boolean;
  /**
   * `true` when the sentence lives in the route as a string literal; `false`
   * when it arrives through a shared imported constant (CIRCUIT_OPEN). Pinned
   * so the two are checked against the right source rather than one silently
   * skipping.
   */
  literalInRoute: boolean;
}

const ROSTER: Record<string, RosterEntry> = {
  // Borrowed from the shared seam vocabulary — the ONE breaker copy. Retry
  // clears it: the breaker reopens after its cooldown, and the arm forwards the
  // wait as a real `Retry-After`.
  CIRCUIT_OPEN: {
    sentence:
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    retryClearsIt: true,
    literalInRoute: false,
  },
  // The upstream's own per-key throttle. Retry clears it once the advertised
  // wait elapses — and the wait rides on the `Retry-After` HEADER, never in the
  // prose, because an unadvertised wait must not become a fabricated number
  // (TRAP-3).
  PROBE_RATE_LIMITED: {
    sentence: "Too many requests",
    retryClearsIt: true,
    literalInRoute: true,
  },
  // 161-01 / WIZERR-04 — the arm this phase exists for. Retry can NEVER clear
  // it: the stored ciphertext stays unreadable until the key is reconnected.
  KEY_UNDECRYPTABLE: {
    sentence:
      "This stored key can no longer be decrypted. Reconnect the key — retrying will not help.",
    retryClearsIt: false,
    literalInRoute: true,
  },
  // Our layer could not reach the permissions service. Transient by nature.
  PROBE_BACKEND_UNAVAILABLE: {
    sentence: "Could not reach the permissions service. Try again shortly.",
    retryClearsIt: true,
    literalInRoute: true,
  },
  // The probe exceeded its deadline. A second attempt genuinely may not.
  PROBE_TIMEOUT: {
    sentence: "Permissions probe timed out. Try again.",
    retryClearsIt: true,
    literalInRoute: true,
  },
  // The reached-but-failed generic. Retry can work, which is why THIS sentence
  // keeps its retry framing while KEY_UNDECRYPTABLE's must not.
  PROBE_FAILED: {
    sentence: "Could not check key scopes. Try again.",
    retryClearsIt: true,
    literalInRoute: true,
  },
};

const ROSTER_CODES = Object.keys(ROSTER).sort();

// ---------------------------------------------------------------------------

describe("[161-01 / WIZERR-04] the derived population is REAL (a scanner that matches nothing agrees forever)", () => {
  it("the route source was actually read", () => {
    expect(
      ROUTE_SRC_RAW.length,
      `${ROUTE_REL} read as fewer than 1000 characters. The path moved or the ` +
        "read failed, and every assertion in this file is now measuring an " +
        "empty string.",
    ).toBeGreaterThan(1000);
  });

  it("the population is NON-EMPTY", () => {
    // A coverage law whose population resolves to the empty set passes
    // trivially and is worse than no law at all. This is that fence.
    expect(
      EMITTED_CODES.length,
      "the emitter scan derived ZERO codes from the permissions route. Both " +
        "needles stopped matching, so every 'every code is…' assertion below " +
        "is vacuously true.",
    ).toBeGreaterThan(0);
  });

  it("the population size equals the HAND-TYPED measured count", () => {
    expect(
      EMITTED_CODES.length,
      `expected ${EXPECTED_TOTAL_CODES} emitted codes (hand-measured at HEAD), ` +
        `derived ${EMITTED_CODES.length}: ${EMITTED_CODES.join(", ")}. If an ` +
        "arm was added or removed on purpose, move this literal deliberately " +
        "and update the roster in the same edit.",
    ).toBe(EXPECTED_TOTAL_CODES);
  });

  it("BOTH emitter shapes contribute — neither needle may silently die", () => {
    // Without this, one needle could break while the other still yielded a
    // non-empty set, and the total-count assertion would be the only thing
    // complaining — with no way to say WHICH half went blind.
    expect(
      SHAPE_A_CODES.length,
      `SHAPE A (\`code: "X"\` response-body properties) derived ` +
        `${SHAPE_A_CODES.length}, expected ${EXPECTED_SHAPE_A_SITES}. The ` +
        "response-body needle stopped matching, or an arm was added/removed.",
    ).toBe(EXPECTED_SHAPE_A_SITES);
    expect(
      SHAPE_B_CODES.length,
      `SHAPE B (\`const code = …;\` cascade literals) derived ` +
        `${SHAPE_B_CODES.length}, expected ${EXPECTED_SHAPE_B_SITES}. The ` +
        "cascade needle stopped matching — most likely because the ternary was " +
        "refactored into a lookup table, which is fine but must be MEASURED " +
        "here rather than silently dropping three codes out of the population.",
    ).toBe(EXPECTED_SHAPE_B_SITES);
  });

  it("the scan is DISCRIMINATING — UPPER_SNAKE literals that are not codes stay out", () => {
    // Measured on the real file, not a fixture: the route contains
    // `ECONNREFUSED` and `INTERNAL_API_TOKEN` as bare string literals (they are
    // the cascade's own sentinel needles). A lazy "every UPPER_SNAKE literal is
    // a code" scan would report 9 codes instead of 6 and quietly demand roster
    // entries for two things that are not codes at all.
    expect(
      ROUTE_SRC,
      "the sentinel literals vanished from the route — this negative control " +
        "is no longer measuring anything.",
    ).toContain('"ECONNREFUSED"');
    expect(ROUTE_SRC).toContain('"INTERNAL_API_TOKEN"');
    expect(EMITTED_CODES).not.toContain("ECONNREFUSED");
    expect(EMITTED_CODES).not.toContain("INTERNAL_API_TOKEN");
  });
});

describe("[161-01 / WIZERR-04] BOTH HALVES — derived population and hand-typed roster agree exactly", () => {
  it("HALF 1 — every DERIVED code is in the roster (a new arm fails BY NAME)", () => {
    const unrostered = EMITTED_CODES.filter((c) => !(c in ROSTER));
    expect(
      unrostered,
      "The permissions route emits a code with no roster entry, so nothing " +
        "checks whether its sentence is honest about the user's situation. " +
        "That is exactly how KEY_UNDECRYPTABLE spent four phases telling the " +
        "owner of a permanently orphaned key to 'Try again.' Add the entry and " +
        "answer its `retryClearsIt` question deliberately. " +
        `Unrostered: ${unrostered.join(", ")}`,
    ).toEqual([]);
  });

  it("HALF 2 — every ROSTER member is still emitted (a deleted arm fails HERE)", () => {
    const vanished = ROSTER_CODES.filter((c) => !EMITTED_CODES.includes(c));
    expect(
      vanished,
      "A roster member is no longer emitted anywhere in the permissions route. " +
        "Either an arm was deleted — in which case the honest remedy it carried " +
        "is gone and its users are back on whatever the cascade says — or the " +
        "scanner stopped seeing it. Both need a human. " +
        `Missing from the route: ${vanished.join(", ")}`,
    ).toEqual([]);
  });

  it("no roster sentence is BLANK (an empty needle matches everything)", () => {
    // ⚠️ FOUND BY THE ANTI-VACUITY MUTATION, NOT BY DESIGN, and kept because
    // the hole is real: `"anything".includes("")` is `true` in JavaScript. So a
    // roster entry blanked to `""` would sail through the sentence check below
    // while asserting precisely nothing — the law would go on reporting six
    // guarded codes with one of them unguarded. The floor is deliberately a
    // LENGTH and not merely non-empty: the shortest shipped sentence is "Too
    // many requests" (17 characters), so 8 leaves room for a genuinely terse
    // future sentence while still refusing a placeholder.
    const blank = Object.entries(ROSTER)
      .filter(([, e]) => e.sentence.trim().length < 8)
      .map(([c]) => c);
    expect(
      blank,
      "A roster sentence is blank or a stub. An empty string is a substring of " +
        "every source file, so the sentence assertion below would pass for it " +
        "forever while checking nothing. Transcribe the real shipped copy. " +
        `Offending codes: ${blank.join(", ")}`,
    ).toEqual([]);
  });

  it("every roster member has its curated sentence at the source the roster names", () => {
    const missing: string[] = [];
    for (const [code, entry] of Object.entries(ROSTER)) {
      if (entry.literalInRoute) {
        if (!ROUTE_SRC.includes(entry.sentence)) missing.push(code);
      } else {
        // The shared-constant half. Asserting the hand-typed transcription
        // against the IMPORTED value is a real pin, not self-reference: it
        // reddens if the shared copy's text moves under this route, and it
        // proves the route reaches the sentence through the shared constant
        // rather than having grown a private duplicate.
        if (entry.sentence !== CIRCUIT_OPEN_COPY) missing.push(code);
        if (!ROUTE_SRC.includes("CIRCUIT_OPEN_COPY")) missing.push(code);
      }
    }
    expect(
      missing,
      "A roster member's curated sentence is not present where the roster says " +
        "it lives. Either the shipped copy changed without this transcription " +
        "moving with it (in which case the law is now vouching for a sentence " +
        "no user sees), or a curated sentence was replaced by an interpolated " +
        `one — which on a 5xx would leak upstream prose (H-1062 / F5b). ` +
        `Offending codes: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("[161-01 / WIZERR-04] REMEDY HONESTY — no arm tells the user to retry a fault a retry cannot clear", () => {
  const IRRECOVERABLE = Object.entries(ROSTER).filter(
    ([, e]) => !e.retryClearsIt,
  );

  it("the irrecoverable sub-population is NON-EMPTY", () => {
    // The sub-population gets its own vacuity fence. If every roster entry were
    // marked `retryClearsIt: true`, the assertion below would iterate an empty
    // list and pass forever while asserting nothing — the same trivially-true
    // failure mode as an empty population, one level down.
    expect(
      IRRECOVERABLE.length,
      "no roster entry is marked `retryClearsIt: false`, so the retry-framing " +
        "check below runs over an empty list and cannot fail. At HEAD exactly " +
        "one arm (KEY_UNDECRYPTABLE) carries a fault a retry cannot clear; if " +
        "that arm was removed, this law's whole reason for existing went with it.",
    ).toBeGreaterThan(0);
  });

  it("no irrecoverable arm carries retry framing", () => {
    const lying = IRRECOVERABLE.filter(([, e]) => /try again/i.test(e.sentence));
    expect(
      lying,
      "An arm whose fault a retry CANNOT clear is telling the user to try " +
        "again. That is not vagueness — it is a false statement about the " +
        "user's situation, and it routes them into an unbounded loop while " +
        "hiding the action that would actually work. Name the real remedy " +
        `instead. Offending codes: ${lying.map(([c]) => c).join(", ")}`,
    ).toEqual([]);
  });

  it("KEY_UNDECRYPTABLE names the action that CAN succeed", () => {
    // The positive half of the same property. Absence of a lie is not presence
    // of a remedy: a sentence could drop "Try again" and still leave the user
    // with nothing to do.
    const sentence = ROSTER.KEY_UNDECRYPTABLE.sentence;
    expect(sentence.toLowerCase()).toContain("reconnect");
    expect(sentence).not.toMatch(/try again/i);
  });

  // ⚠️ DECLARED BLINDNESS — the CONVERSE is deliberately NOT asserted. "Every
  // recoverable arm must contain retry framing" would be false of a correct
  // arm: `PROBE_RATE_LIMITED` reads "Too many requests" and expresses its wait
  // through the `Retry-After` HEADER, because the upstream advertised a
  // duration and prose must never restate a number it can derive (nor invent
  // one it cannot — TRAP-3). Asserting the converse would force a sentence that
  // either duplicates the header or fabricates a wait.
});

describe("[161-01 / WIZERR-04] SELF-TEST — the scanner actually reads THIS route's shapes", () => {
  it("POSITIVE — reads a code out of the response-body shape (SHAPE A)", () => {
    const shapeA = `
      return NextResponse.json(
        { error: "Too many requests", code: "SELFTEST_ALPHA" },
        { status: 429, headers: NO_STORE_HEADERS },
      );
    `;
    expect(scanEmittedCodes(stripCommentsPreserveLines(shapeA, "ts"))).toEqual([
      "SELFTEST_ALPHA",
    ]);
  });

  it("POSITIVE — reads codes out of the bare-ternary shape (SHAPE B)", () => {
    const shapeB = `
      const code = isConfigError
        ? "SELFTEST_BETA"
        : isTimeout
        ? "SELFTEST_GAMMA"
        : "SELFTEST_DELTA";
    `;
    expect(scanEmittedCodes(stripCommentsPreserveLines(shapeB, "ts"))).toEqual([
      "SELFTEST_BETA",
      "SELFTEST_DELTA",
      "SELFTEST_GAMMA",
    ]);
  });

  it("NEGATIVE — a code that appears ONLY inside a comment is NOT counted", () => {
    // DEF-16-2, and it is a live shape in this exact file: the route's own
    // docblocks name `PROBE_BACKEND_UNAVAILABLE` and `PROBE_FAILED` in prose
    // while explaining the cascade. An unstripped scan would count those
    // mentions as emitters and certify arms that do not exist.
    const commentOnly = `
      // One day this arm will answer { code: "SELFTEST_PHANTOM" }.
      /* const code = "SELFTEST_SPECTRE"; */
      return NextResponse.json({ error: "real", code: "SELFTEST_REAL" });
    `;
    expect(
      scanEmittedCodes(stripCommentsPreserveLines(commentOnly, "ts")),
    ).toEqual(["SELFTEST_REAL"]);
    // …and this is what a naive, unstripped scan would have seen instead.
    expect(scanEmittedCodes(commentOnly)).toEqual([
      "SELFTEST_PHANTOM",
      "SELFTEST_REAL",
      "SELFTEST_SPECTRE",
    ]);
  });

  it("NEGATIVE — a bare UPPER_SNAKE literal outside both shapes is NOT counted", () => {
    const bare = `
      const isConfigError = rawMessage.includes("ECONNREFUSED");
      const label = "SOME_CONSTANT";
    `;
    expect(scanEmittedCodes(stripCommentsPreserveLines(bare, "ts"))).toEqual([]);
  });
});
