// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

/**
 * 142.2-06 / MT5-12 — THE GATE HOLDS NO VENUE KNOWLEDGE.
 *
 * ── WHAT THIS FILE EXISTS TO STOP ───────────────────────────────────────────
 *
 * `strategyGate.ts` used to decide whether a KEYED strategy could publish on
 * its daily-return series by asking which exchange the key pointed at:
 *
 *     export function isLedgerBackedExchange(exchange) {
 *       return exchange === "deribit";
 *     }
 *
 * The venue list was a proxy for a question it cannot answer — "is this daily
 * series complete?" — and its only enforcement was a comment instructing the
 * reader to keep it in lockstep with a Python set. The Python set widened to
 * three venues. TypeScript stayed at one. A funded MetaTrader 5 account with
 * 135 canonical daily rows landed on GATE_INSUFFICIENT_TRADES, unwinnable, and
 * the wizard's remedy for that state destroys the draft.
 *
 * The consolidation deleted the venue list and moved the judgement to the
 * producers, who stamp `strategy_analytics.series_completeness` at the moment
 * they write the series and can still see its inputs. This guard is what makes
 * a REGRESSION DETECTABLE rather than re-instructed: the next venue that needs
 * unblocking must be unblocked by stamping a verdict, not by adding a name
 * here. A comment already failed at this job once.
 *
 * ── WHY A SOURCE-READING TEST AND NOT A BEHAVIOURAL ONE ─────────────────────
 *
 * A behavioural test can only observe the venues someone thought to test. The
 * defect class is "a venue literal reappears in the gate", and the only
 * assertion that catches ALL of them is one that reads the file.
 *
 * ── THE PREDICATE, stated so a count taken here is reproducible ─────────────
 *
 *   Read `src/lib/strategyGate.ts` from disk. Strip comments and docstrings
 *   with `stripCommentsPreserveLines(src, "ts")` — which BLANKS comment
 *   characters while preserving every line and column, and LEAVES STRING
 *   CONTENTS INTACT. Lowercase the result. Then assert that none of the
 *   hand-typed venue names below occurs as a substring.
 *
 *   Two consequences of that tokenizer, both deliberate:
 *     - A venue named in a COMMENT does not fail this test. Prose explaining
 *       why the venue list was deleted is allowed to name the venue; only code
 *       is under the ban.
 *     - A venue name inside a STRING LITERAL DOES fail. That is the shape the
 *       ban is actually about — `exchange === "deribit"` lives in a string.
 *
 * ⚠️ ANTI-VACUITY. Every assertion above is an ABSENCE, and an absence
 * assertion is green over an empty derivation: it passes if the file is empty,
 * missing, renamed, or if the scanner silently returned "". `source-scan.ts`'s
 * own docblock places the fence obligation on its callers explicitly, because
 * it blanks trailing comments and therefore fails SILENT rather than loud. The
 * positive floor and the SELF-TESTs below are what make the zeros mean
 * something.
 */

const GATE_PATH = join(process.cwd(), "src", "lib", "strategyGate.ts");

/**
 * HAND-TYPED. Every venue this codebase has an adapter or a wizard card for,
 * plus the three the Python `_LEDGER_BACKED_SOURCES` set holds. Not derived
 * from `closed-sets.ts` — a derivation would shrink to nothing the day that
 * module is refactored, and shrink SILENTLY, which is the failure this whole
 * file is built against (Oracle Independence).
 *
 * MT5-12 states the invariant as "no hardcoded venue set governs gate routing",
 * so the roster is deliberately WIDER than the venue that caused the defect:
 * banning only "deribit" would let the next quick fix write "mt5".
 */
const BANNED_VENUE_LITERALS: readonly string[] = [
  "deribit",
  "sfox",
  "mt5",
  "binance",
  "bybit",
  "okx",
];

/**
 * HAND-TYPED, and deliberately NOT imported from `strategyGate.ts`.
 *
 * These are the three verdicts that admit a strategy to the daily-returns
 * branch. Importing `SERIES_TRUSTED_FOR_DAILY_BRANCH` would make this test
 * widen silently the moment the policy widens — the assertion would follow the
 * code instead of pinning it. Typed out here, adding a fourth verdict to
 * production REDDENS this file, which is the point: widening who may publish
 * an unverified-by-fills track record is a decision that must be made twice.
 */
const EXPECTED_ALLOW_LIST_LITERALS: readonly string[] = [
  "ledger_complete",
  "user_supplied",
  "composite_stitched",
];

/**
 * HAND-TYPED VACUITY FLOOR, in characters of comment-stripped source.
 *
 * The gate is ~200 lines of real code before comments; 1,500 stripped
 * characters is far below that and far above anything a broken read could
 * produce. Its only job is to fail loudly if the file went missing, was
 * renamed, or came back empty — the three ways every absence assertion in this
 * file turns green while measuring nothing.
 */
const STRIPPED_SOURCE_FLOOR = 1500;

function readStrippedGateSource(): string {
  return stripCommentsPreserveLines(readFileSync(GATE_PATH, "utf8"), "ts");
}

describe("[142.2-06 / MT5-12] strategyGate.ts holds NO venue knowledge", () => {
  const stripped = readStrippedGateSource();
  const haystack = stripped.toLowerCase();

  // --- The positive floor. Read this block first: without it, every absence
  //     assertion below is satisfied by an empty string. ---

  it("NOT VACUOUS — the file was read and has real content after stripping", () => {
    expect(
      stripped.length,
      `Read only ${stripped.length} characters of comment-stripped source from ` +
        `${GATE_PATH} (floor ${STRIPPED_SOURCE_FLOOR}). PREDICATE: readFileSync ` +
        `then stripCommentsPreserveLines(src,"ts"). A number this low means the ` +
        `FILE MOVED or the scanner broke — not that the gate got smaller — and ` +
        `every venue-absence assertion below would pass vacuously.`,
    ).toBeGreaterThanOrEqual(STRIPPED_SOURCE_FLOOR);
  });

  it("NOT VACUOUS — the module under test is still the gate (its two exports are present)", () => {
    // Names the file must contain for the absence assertions to be ABOUT the
    // gate. If `checkStrategyGate` ever leaves this module, this test is the
    // one that says so, rather than the venue scan quietly passing on a file
    // that no longer decides anything.
    expect(stripped).toContain("checkStrategyGate");
    expect(stripped).toContain("isDailyReturnsSourced");
  });

  it.each(EXPECTED_ALLOW_LIST_LITERALS)(
    "NOT VACUOUS — the allow-list literal %s is present in source (hand-typed here, never imported)",
    (verdict) => {
      // The other half of the fence, and the more useful one. A gate that
      // deleted its allow-list entirely would pass every venue-absence check
      // above; this reds. It also pins the allow-list's MEMBERSHIP: widening
      // production without editing this file fails the exact-count assertion
      // below.
      expect(stripped).toContain(`"${verdict}"`);
    },
  );

  it("the allow-list has EXACTLY the three hand-typed members — no silent widening", () => {
    // Scoped to the Set INITIALIZER, not the whole file: `strategyGate.ts` also
    // carries `"complete_with_warnings"`, a computation STATUS, and a
    // file-wide snake_case scan would conflate the two vocabularies.
    //
    // Keying off the constant's name is deliberate. Renaming or deleting
    // `SERIES_TRUSTED_FOR_DAILY_BRANCH` reds HERE with the message below rather
    // than silently reducing this to a zero-member comparison.
    const block = /SERIES_TRUSTED_FOR_DAILY_BRANCH[^=]*=\s*new Set\(\[([^\]]*)\]/
      .exec(stripped);
    expect(
      block,
      "could not locate `SERIES_TRUSTED_FOR_DAILY_BRANCH = new Set([...])` in " +
        "strategyGate.ts. Either the allow-list was renamed/removed, or its " +
        "shape changed — re-point this guard deliberately; do NOT delete it.",
    ).not.toBeNull();

    const members = [
      ...(block as RegExpExecArray)[1].matchAll(/"([^"]+)"/g),
    ].map((m) => m[1]);
    // Sorted arrays, not sets, so a failure NAMES what moved.
    expect(members.sort()).toEqual([...EXPECTED_ALLOW_LIST_LITERALS].sort());
  });

  // --- The ban itself. ---

  it.each(BANNED_VENUE_LITERALS)(
    "contains ZERO occurrences of the venue literal %s (comments excluded)",
    (venue) => {
      const occurrences = haystack.split(venue).length - 1;
      expect(
        occurrences,
        `${venue} appears ${occurrences} time(s) in the comment-stripped source ` +
          `of strategyGate.ts. MT5-12: no hardcoded venue set governs gate ` +
          `routing. The gate reads strategy_analytics.series_completeness — a ` +
          `verdict its PRODUCER stamped, because only the producer could still ` +
          `see the series' inputs. If a venue needs unblocking, stamp a verdict ` +
          `for it; re-adding a name here restores the drift that shipped a ` +
          `135-day MT5 account into an unwinnable GATE_INSUFFICIENT_TRADES.`,
      ).toBe(0);
    },
  );

  // --- SELF-TESTs. The mutation in the Falsifiability Ledger (SC-3) only
  //     counts as caught because these prove the scanner is ALIVE: both that it
  //     finds a venue literal in code, and that it does not find one that is
  //     only in a comment. ---

  it("SELF-TEST — a venue literal in CODE is found by this scanner", () => {
    const synthetic = [
      "export function isLedgerBackedExchange(exchange: string) {",
      '  return exchange === "deribit";',
      "}",
    ].join("\n");
    const strippedSynthetic = stripCommentsPreserveLines(
      synthetic,
      "ts",
    ).toLowerCase();
    // The exact shape this file bans, put through the exact scanner it uses.
    expect(strippedSynthetic).toContain("deribit");
    expect(strippedSynthetic.split("deribit").length - 1).toBe(1);
  });

  it("SELF-TEST — a venue literal inside a COMMENT is NOT counted after stripping", () => {
    // The negative half. A scanner that counted comments would redden on the
    // gate's own prose explaining why the venue list was deleted, and the
    // obvious "fix" would be to delete the explanation — losing the reason
    // while keeping the rule.
    const synthetic = [
      "// The venue list named deribit and it was deleted; see MT5-12.",
      "/* A block comment mentioning binance and okx. */",
      'const verdict = "ledger_complete";',
    ].join("\n");
    const strippedSynthetic = stripCommentsPreserveLines(
      synthetic,
      "ts",
    ).toLowerCase();
    expect(strippedSynthetic).not.toContain("deribit");
    expect(strippedSynthetic).not.toContain("binance");
    expect(strippedSynthetic).not.toContain("okx");
    // …and the code on the surviving line is untouched, so the stripper is
    // blanking comments rather than eating the file.
    expect(strippedSynthetic).toContain("ledger_complete");
  });

  it("SELF-TEST — a venue literal in a STRING is counted (strings are code, not prose)", () => {
    // `source-scan.ts` deliberately preserves string contents. That is what
    // makes this guard work at all: the banned construct IS a string
    // comparison. If that contract ever changed, this reds.
    const synthetic = 'const venues = ["mt5", "sfox"];';
    const strippedSynthetic = stripCommentsPreserveLines(
      synthetic,
      "ts",
    ).toLowerCase();
    expect(strippedSynthetic).toContain("mt5");
    expect(strippedSynthetic).toContain("sfox");
  });
});
