import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  ENCRYPT_KEY_BUDGET_MS,
  VALIDATE_KEY_BUDGET_MS,
  VALIDATE_KEY_SERIALIZED_BUDGET_MS,
  WAIT_ABORT_GRACE_MS,
  WAIT_CARD_MOUNT_DELAY_MS,
  WAIT_QUEUE_FRACTION,
  WAIT_SLOW_FRACTION,
  connectAbortDeadlineMsFor,
  validateBudgetMsFor,
  validateBudgetSecondsFor,
} from "./validate-budget";

/**
 * Phase 153.4-03 — the client-safe budget module.
 *
 * Two jobs, and they are different in kind:
 *
 *  1. BEHAVIOUR — the selector puts every venue on the arm the seam will actually
 *     spend, including every shape of unrecognised input a wizard form can produce.
 *     The table below is HAND-TYPED, venue by venue, rather than derived from
 *     `VENUE_CAPABILITIES`: a table built by asking the same predicate the function
 *     asks cannot disagree with it.
 *
 *  2. BUNDLE SAFETY — the module never grows an import edge to the seam core. That is
 *     the only assertion here that can catch a future "simplify this by importing the
 *     table" edit, and it is checked by reading this module's source off disk.
 *
 * ⛔ The cross-module agreement with `SEAM_BUDGETS` is NOT asserted here. It lives in
 * `src/lib/seam-constants.pin.test.ts` (search it for "the CLIENT-SAFE budget module
 * agrees with the seam table"), because that file is where both sides of every seam
 * figure are hand-typed and where a reader already goes to ask "is this number real?".
 */

describe("[WIZFORM-05] validateBudgetMsFor — the arm is chosen by CAPABILITY", () => {
  // Hand-typed, one row per SUPPORTED_EXCHANGES member. Six rows, and the count is
  // deliberately not derived: a seventh venue SHOULD force a human to answer "does it
  // queue?" here rather than silently inherit the default.
  it.each([
    ["binance", 30_000],
    ["okx", 30_000],
    ["bybit", 30_000],
    ["deribit", 30_000],
    ["sfox", 30_000],
    ["mt5", 120_000],
  ])("%s gets a %d ms budget", (exchange, expected) => {
    expect(
      validateBudgetMsFor(exchange),
      `${exchange} moved to the other budget arm. The figure this function returns is ` +
        `what the long-wait card PROMISES the user in copy ("We wait up to Ns"), and ` +
        `what analytics-client's budgetKeyFor selects the seam row by. If the two ` +
        `disagree, the wizard is promising a wait the seam will not honour.`,
    ).toBe(expected);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unrecognised venue", "kraken"],
    ["a path-traversal-shaped string", "../../etc/passwd"],
    ["an Object.prototype member name", "constructor"],
  ])("%s falls back to the DEFAULT budget", (_label, input) => {
    // Same fallback direction as budgetKeyFor, and for the same reason: `exchange`
    // arrives from a wizard form, so an unrecognised value is NORMAL input, not an
    // error. Falling back to the LONG budget would promise a two-minute wait for a
    // venue that answers in seconds — and would let an arbitrary string buy the
    // expensive arm.
    expect(validateBudgetMsFor(input)).toBe(30_000);
  });

  it("a MIXED-CASE serialized venue still gets the serialized budget", () => {
    // `canonicalizeExchange` hands back the DISPLAY form ("MT5"), so callers
    // legitimately pass mixed case. A case-sensitive check here would put the wizard's
    // own display value on the 30 s arm while the server spent 120 s.
    expect(validateBudgetMsFor("MT5")).toBe(120_000);
    expect(validateBudgetMsFor("Mt5")).toBe(120_000);
  });
});

describe("[WIZFORM-05] validateBudgetSecondsFor — the ONE owner of the copy figure", () => {
  it("reports whole seconds for both arms", () => {
    expect(validateBudgetSecondsFor("mt5")).toBe(120);
    expect(validateBudgetSecondsFor("binance")).toBe(30);
    expect(validateBudgetSecondsFor(null)).toBe(30);
  });

  it("agrees with the millisecond figure it is derived from", () => {
    // Not a tautology: this is the assertion that reds if the seconds helper ever
    // grows its own rounding rule, a floor, or a "+5 for safety" fudge. Every sentence
    // in the wait card reads this function, so a divergence here is a divergence
    // between the copy and the deadline.
    for (const venue of ["mt5", "binance", null]) {
      expect(validateBudgetSecondsFor(venue) * 1_000).toBe(
        validateBudgetMsFor(venue),
      );
    }
  });
});

describe("[WIZFORM-05] the ladder is FRACTIONS, and the card's timings", () => {
  it("the two fractions are the hand-typed 0.4 and 0.75", () => {
    expect(
      WAIT_QUEUE_FRACTION,
      "The queue-disclosure threshold moved. It gates BOTH the queue sentence and the " +
        "`Stop waiting` control, so lowering it makes the cancel affordance flash on " +
        "the ccxt fast path and raising it delays the only escape from a stall.",
    ).toBe(0.4);
    expect(
      WAIT_SLOW_FRACTION,
      "The slow-disclosure threshold moved. It is the only warning-toned line in the " +
        "card and it must still sit INSIDE the budget — a warning that fires at or " +
        "after the deadline says nothing the verdict is not about to say.",
    ).toBe(0.75);
  });

  it("the ladder is ordered and strictly inside the budget", () => {
    // A ladder that inverts would show "This is slower than usual" before "Still
    // signing in"; a fraction at or above 1 would make the line unreachable, and the
    // card would go from steady-state straight to a verdict with no escalation at all.
    expect(WAIT_QUEUE_FRACTION).toBeGreaterThan(0);
    expect(WAIT_QUEUE_FRACTION).toBeLessThan(WAIT_SLOW_FRACTION);
    expect(WAIT_SLOW_FRACTION).toBeLessThan(1);
  });

  it("the thresholds land where the arithmetic says, on BOTH arms", () => {
    // The point of fractions: the same two constants produce 48 s / 90 s on the
    // serialized arm and 12 s / 22.5 s on the default one. Hand-typed on the expected
    // side so this reds if either fraction OR either budget moves.
    expect(validateBudgetMsFor("mt5") * WAIT_QUEUE_FRACTION).toBe(48_000);
    expect(validateBudgetMsFor("mt5") * WAIT_SLOW_FRACTION).toBe(90_000);
    expect(validateBudgetMsFor("binance") * WAIT_QUEUE_FRACTION).toBe(12_000);
    expect(validateBudgetMsFor("binance") * WAIT_SLOW_FRACTION).toBe(22_500);
  });

  it("the card's mount delay is 300 ms", () => {
    // UI-SPEC Surface 1 render gate — a sub-300 ms answer must never flash a card.
    expect(WAIT_CARD_MOUNT_DELAY_MS).toBe(300);
  });

  it("the abort grace is a POSITIVE margin over the budget", () => {
    // The browser must give up LATER than the deadline it advertises, never earlier:
    // the seam deadline fires inside our route and the reply still has to travel back.
    // A zero or negative grace would abort a verdict already on the wire and re-create
    // the silent UNKNOWN this phase exists to end.
    expect(WAIT_ABORT_GRACE_MS).toBe(15_000);
    expect(
      validateBudgetMsFor("mt5") + WAIT_ABORT_GRACE_MS,
    ).toBeGreaterThan(VALIDATE_KEY_SERIALIZED_BUDGET_MS);
  });
});

/**
 * 153.4 review CR-01 — the CLIENT DEADLINE COVERS THE ROUTE, NOT ONE OF ITS LEGS.
 *
 * The browser aborts `create-with-key` / `composite/add-key`, and each of those
 * spends `validateKey` THEN `encryptKey` THEN an RPC. Neither reads
 * `request.signal`, so the abort stops the BROWSER listening and nothing else. A
 * deadline sized on the validate leg alone therefore fired almost exclusively in
 * the window where validate had SUCCEEDED and the route was storing the key — and
 * `SEAM_DEADLINE_EXCEEDED`'s copy says "Nothing was saved — your key was not
 * stored".
 *
 * Every expected figure below is HAND-TYPED rather than composed from the
 * constants, for the reason the file docblock gives: an expectation built by
 * adding the same three constants the function adds cannot disagree with it.
 */
describe("[CR-01] connectAbortDeadlineMsFor — the deadline covers BOTH seam legs", () => {
  it("the encrypt leg is the hand-typed 30 000 ms", () => {
    // Twin of `SEAM_BUDGETS["encrypt-key"].timeoutMs`. Pinned here on this
    // module's own terms; the cross-module agreement with the seam table belongs
    // beside the other two figures in `seam-constants.pin.test.ts`.
    expect(ENCRYPT_KEY_BUDGET_MS).toBe(30_000);
  });

  it("the serialized arm gives up at 165 000 ms, the default arm at 75 000 ms", () => {
    expect(
      connectAbortDeadlineMsFor("mt5"),
      "the browser's deadline moved off the ROUTE's worst case. Below " +
        "validate + encrypt it fires while the route is still encrypting and " +
        "storing a key that validated — and the verdict it renders claims " +
        "nothing was saved.",
    ).toBe(165_000);
    expect(connectAbortDeadlineMsFor("binance")).toBe(75_000);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unrecognised venue", "kraken"],
  ])("%s falls back to the DEFAULT arm's deadline", (_label, input) => {
    // Same fallback direction, and for the same reason, as `validateBudgetMsFor`:
    // `exchange` is a wizard form value, so an unrecognised string is normal
    // input rather than an error.
    expect(connectAbortDeadlineMsFor(input)).toBe(75_000);
  });

  it("⭐ the deadline is STRICTLY LATER than the validate budget the copy advertises", () => {
    // ⭐ THE PROPERTY, stated without naming either figure. The window between
    // the advertised budget and this deadline is exactly the interval in which
    // the route has finished validating and is encrypting + storing the key; a
    // deadline inside it turns a SUCCEEDING request into a "nothing was saved"
    // verdict. This reds for any future edit that re-ties the deadline to the
    // validate leg, whatever the budgets happen to be.
    for (const venue of ["mt5", "binance", null]) {
      expect(
        connectAbortDeadlineMsFor(venue),
        `${venue}'s client deadline no longer clears its validate budget plus ` +
          `the encrypt leg the route spends after it.`,
      ).toBeGreaterThanOrEqual(
        validateBudgetMsFor(venue) + ENCRYPT_KEY_BUDGET_MS,
      );
    }
  });

  it("both deadlines clear their route's FAILING-state worst case (PARITY-03)", () => {
    // ⛔ THE COLUMN IS THE WHOLE POINT, and the previous version of this `it`
    // got it wrong. It required only "greater than 158 500" — the CLOSED cell of
    // the create-with-key / serialized-venue row in `seam-budgets.invariant.test.ts`'s
    // branch table. A stalling seam is not in the closed state: a client deadline
    // fires precisely when the seam is failing, which is the state that also pays
    // the breaker's trip-path store commands. The governing figures are the
    // FAILING ones, hand-typed here from that table:
    //
    //   serialized-venue  150 000 request (120 000 validate-key-serialized
    //                     + 30 000 encrypt-key, both retries: 0)
    //                   +  25 500 store (2 legs x 3 commands x 4 250)
    //                   = 175 500
    //   default-venue      60 000 request (30 000 validate-key + 30 000
    //                     encrypt-key)
    //                   +  25 500 store (identical — the store term does not
    //                     depend on the validate budget, which is why BOTH arms
    //                     were short by the same 10 500 ms)
    //                   =  85 500
    //
    // The browser must be the LAST party to give up, so a client abort can only
    // ever mean the server stopped answering — the state the deadline copy
    // describes.
    //
    // ⚠️ THIS IS THE SECONDARY GUARD. The PRIMARY one is
    // `seam-budgets.invariant.test.ts` › "the browser is the last party to give
    // up", which quantifies the same property over EVERY breaker state using
    // that file's own `branchWorstCases`, so no column can be selected at all.
    // These two literals cannot notice that the wrong CELL was copied; that one
    // can. Both are kept because this file is where a reader of the client
    // module looks.
    expect(
      connectAbortDeadlineMsFor("mt5"),
      "the serialized client deadline no longer clears create-with-key / " +
        "composite/add-key's FAILING-state worst case of 175 500 ms.",
    ).toBeGreaterThan(175_500);
    expect(
      connectAbortDeadlineMsFor("binance"),
      "the DEFAULT arm's client deadline no longer clears its FAILING-state " +
        "worst case of 85 500 ms. This arm is the second member of the class: " +
        "the 153.4 review named only the serialized one, and both were short.",
    ).toBeGreaterThan(85_500);
  });
});

describe("[T-153.4-10] the module carries NO import edge to the seam core", () => {
  const RELATIVE_PATH = "src/lib/wizard/validate-budget.ts";
  const SOURCE = readFileSync(join(process.cwd(), RELATIVE_PATH), "utf8");

  /**
   * Comment-stripped source. Block comments are blanked character-for-character so line
   * numbers survive; a whole-line `//` becomes an empty line.
   *
   * ⚠️ THE STRIP IS THE WHOLE ACCURACY OF THIS SCAN, and it is the house pattern, not
   * an invention: `seam-ssr-exposure.pin.test.ts` does exactly this and its own
   * self-test pins that a COMMENT naming a seam module must NOT match. Fourteen files
   * under `src/` name these modules in prose precisely to explain why they must never
   * import them — `validate-budget.ts` is the fifteenth, and a naive substring grep
   * would report every one of them as a violation. The natural "fix" for such a grep is
   * to delete the explanation, which is the opposite of what the guard is for.
   */
  const STRIPPED = SOURCE.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  )
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");

  /**
   * Matches a MODULE SPECIFIER — `from "…"`, `import("…")`, `require("…")` — never a
   * bare mention.
   */
  const SPECIFIERS: readonly string[] = [
    ...STRIPPED.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);

  const FORBIDDEN = /resilient-fetch|analytics-client|next\/server|@upstash/;

  it("the source scan actually read the module (fail-loud on a broken read)", () => {
    // VACUITY FLOOR, hand-typed well under the real figure (the module is ~140 lines
    // and carries exactly one import today). A scan that silently read an empty string
    // would report the module clean forever, which is worse than no guard because it
    // reads as protection.
    expect(SOURCE.length).toBeGreaterThan(2_000);
    expect(
      SPECIFIERS.length,
      "No module specifier was extracted from validate-budget.ts, so the assertion " +
        "below is vacuous. Fix the extraction, never the assertion.",
    ).toBeGreaterThanOrEqual(1);
  });

  it("the extractor matches a specifier and NOT a prose mention", () => {
    // The negative half is the load-bearing one, for the reason written above the
    // strip. Without it, this guard's first false positive would be its own docblock.
    const probe = (src: string): string[] =>
      [
        ...src.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g),
      ].map((m) => m[1]);
    expect(probe(`import { x } from "@/lib/resilient-fetch";`)).toEqual([
      "@/lib/resilient-fetch",
    ]);
    expect(probe(`await import("@/lib/analytics-client");`)).toEqual([
      "@/lib/analytics-client",
    ]);
    expect(probe(`the seam core lives in resilient-fetch.ts`)).toEqual([]);
  });

  it("no specifier names the seam core, next/server or an Upstash package", () => {
    const offenders = SPECIFIERS.filter((s) => FORBIDDEN.test(s));
    expect(
      offenders,
      "validate-budget.ts grew an import edge to a SERVER-ONLY module. This module " +
        "exists so a `use client` wizard step can read the budget WITHOUT dragging " +
        "the seam core — and a Redis client, and the breaker keyspace — into the " +
        "browser bundle. The duplication is deliberate and its safety is the " +
        "agreement pin in seam-constants.pin.test.ts, NOT an import. ⛔ Do not close " +
        "this by importing SEAM_BUDGETS; that is the edit this assertion exists to " +
        "catch. (seam-ssr-exposure.pin.test.ts independently covers the three seam " +
        "modules for every non-client file under src/; this one adds next/server and " +
        "@upstash, which that pin does not scan for.)",
    ).toEqual([]);
  });

  it("the only import is the capability predicate", () => {
    // Positive control. An empty offenders list is also what a module with NO imports
    // at all produces — including one where the selector has been inlined as an
    // `exchange === "mt5"` instance check, which is the defect class this repo has
    // already paid for twice.
    expect(SPECIFIERS).toEqual(["@/lib/closed-sets"]);
    expect(STRIPPED).toContain("venueIsSerialized");
  });

  it("the PROVISIONAL caveat travels with the number (D-27)", () => {
    // The 120 000 exists in two places now. The SEAM_BUDGETS row states that it is the
    // founder's staleness tolerance and not a measurement; a copy of the number
    // WITHOUT that sentence is how a provisional figure becomes a settled one.
    expect(SOURCE).toContain("PROVISIONAL");
    expect(SOURCE).toContain("Phase 155");
  });
});

describe("[WIZFORM-05] the client figures are hand-typed literals", () => {
  it("the two budgets are 30 000 ms and 120 000 ms", () => {
    // Pinned HERE as well as in seam-constants.pin.test.ts, on purpose: this file is
    // where a reader of the client module looks. The agreement pin proves the two
    // modules match; this proves this module is right on its own terms, so "both moved
    // together to a wrong value" reds in one of the two places.
    expect(VALIDATE_KEY_BUDGET_MS).toBe(30_000);
    expect(VALIDATE_KEY_SERIALIZED_BUDGET_MS).toBe(120_000);
  });
});
