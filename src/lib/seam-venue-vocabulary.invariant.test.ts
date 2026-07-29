// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";
import {
  VENUE_WIRE_CODE_TO_VERDICT,
  VENUE_WIRE_CODES_WITHOUT_VERDICT,
} from "./wizardErrors";

/**
 * 140.5-02 / SEAMPROSE-03 — EVERY CODE THE PYTHON SERVICES ACTUALLY EMIT HAS AN
 * EXPLICIT TYPESCRIPT DISPOSITION.
 *
 * ── WHAT THIS FILE EXISTS TO STOP ───────────────────────────────────────────
 *
 * `analytics-service` mints an `error_code` on every failing key-validation
 * verdict and forwards it verbatim as a 424 `code`. TypeScript resolves it in
 * `VENUE_WIRE_CODE_TO_VERDICT`, and anything absent from that table falls
 * through to a substring cascade over the HUMAN sentence. Measured before this
 * plan, that fall-through was not a graceful degradation:
 *
 *   MISSING_SCOPE      -> UNKNOWN/500          a fixable key scope rendered as
 *                                              "we could not classify this"
 *   PERMISSION_DENIED  -> KEY_IP_ALLOWLIST/502 a server status for a caller
 *                                              fault, asserting ONE of the two
 *                                              causes the exchange named
 *   WITHDRAW_SCOPE     -> KEY_HAS_TRADING_PERMS a withdrawal-capable key told
 *                                              its problem was trading
 *
 * Each was invisible until someone replayed the real Python string by hand. A
 * code minted tomorrow would be invisible the same way. This guard makes the
 * arrival LOUD.
 *
 * ── HONEST STATEMENT OF WHAT IT IS — READ BEFORE TRUSTING IT ────────────────
 *
 * ⚠️ `VENUE_WIRE_CODE_TO_VERDICT` IS **COVERAGE-LAW ROW 2** — a hand-typed
 * roster, **PARTIAL BY CONSTRUCTION**, in those words. This guard does NOT
 * promote it to row 1 and no claim of "effective row 1" is made here. The
 * row-1 remedy is a shared `WireErrorCode` union across the two languages,
 * which this phase does not schedule. What the guard adds is strictly
 * FAIL-LOUD ARRIVAL: the POPULATION it checks against is derived from the real
 * emitters on disk, so a newly-emitted code reddens CI, by name, until someone
 * writes its disposition. A roster that cannot silently miss a new member is
 * still a roster.
 *
 * ⚠️ THE POPULATION IS DERIVED FROM THE **EMITTERS**, NOT FROM
 * `services/ingestion/adapter.py`'s closed-set enumeration. That enumeration is
 * a COMMENT. Comment-stripping it — which this guard must do, because a
 * milestone about prose has its needles inside prose more often than anywhere
 * else — yields the EMPTY SET, and a guard born on an empty population is
 * green forever while measuring nothing. It also misses
 * `services/ingestion/csv_adapter.py`'s `CSV_TOO_LARGE` and
 * `CSV_FORMAT_UNSUPPORTED`, which the comment does not list at all.
 *
 * ⚠️ DECLARED BLIND SPOT — A DYNAMIC EMITTER NO STATIC DERIVATION CAN
 * ENUMERATE. `services/ingestion/csv_adapter.py`'s CSV validation arm sets
 * `error_code=first_rule.upper() if first_rule else "CSV_VALIDATION_FAILED"`.
 * `first_rule` is a pandera rule name read out of the validation report, so the
 * family is OPEN: `COLUMN_IN_DATAFRAME`, `MONOTONIC_DATES` and every rule added
 * later are emitted codes this derivation cannot see. Their disposition is
 * BY FAMILY and is stated rather than hidden: they are CSV-surface codes,
 * rendered by the CSV route's own vocabulary through `CsvValidationEnvelope`,
 * and they never reach `classifyKeyValidationError`. The guard asserts below
 * that this site is SEEN and yields no literal, so a NEW dynamic emitter
 * appearing elsewhere reds rather than passing unnoticed.
 */

const SERVICES_ROOT = join(process.cwd(), "analytics-service", "services");

/**
 * THE PREDICATE, stated in full so a count taken from this file can be
 * reproduced without reading the code:
 *
 *   For every `*.py` under `analytics-service/services/**` (recursive), strip
 *   comments and docstrings with `stripCommentsPreserveLines(src, "py")`, then
 *   find every assignment whose left-hand side is `error_code`, in the three
 *   forms this repo actually uses:
 *       error_code = "X"                 (bare)
 *       result["error_code"] = "X"       (subscript)
 *       error_code="X"                   (kwarg)
 *   For each, take the right-hand side from just after the `=` up to the first
 *   `,` or newline encountered at PAREN DEPTH ZERO — so a parenthesised
 *   multi-line ternary is one RHS, and a kwarg is bounded by its own comma —
 *   and collect every `"[A-Z][A-Z0-9_]{2,}"` literal inside it.
 *
 * The depth-aware RHS window is not decoration. `exchange.py` sets
 * `result["error_code"]` from a parenthesised ternary spanning four lines whose
 * ELSE branch is `MISSING_SCOPE` — the single worst code to miss, since it is
 * the one that was rendering UNKNOWN/500. A line-bounded regex silently drops
 * it and the derivation looks fine.
 */
const ASSIGNMENT_RE =
  /(?:\[\s*["']error_code["']\s*\]|(?:^|[^A-Za-z0-9_."'])error_code)\s*=(?!=)/g;
const CODE_LITERAL_RE = /["']([A-Z][A-Z0-9_]{2,})["']/g;

interface EmitterSite {
  file: string;
  line: number;
  codes: string[];
}

function pyFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pyFiles(full));
    else if (entry.name.endsWith(".py")) out.push(full);
  }
  return out.sort();
}

/** The RHS of an assignment starting at `from`, bounded at paren depth 0. */
function rhsWindow(src: string, from: number): string {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (c === "\n" || c === ",")) break;
    i += 1;
  }
  return src.slice(from, i);
}

function deriveEmitterSites(): EmitterSite[] {
  const sites: EmitterSite[] = [];
  for (const file of pyFiles(SERVICES_ROOT)) {
    // ⚠️ COMMENT-STRIP BEFORE COUNTING (DEF-16-2). Two `error_code="…"`
    // occurrences in this very tree live inside comments — one of them names
    // MISSING_SCOPE — and a raw scan would count both as emitters.
    const stripped = stripCommentsPreserveLines(readFileSync(file, "utf-8"), "py");
    ASSIGNMENT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ASSIGNMENT_RE.exec(stripped)) !== null) {
      const rhs = rhsWindow(stripped, m.index + m[0].length);
      const codes: string[] = [];
      CODE_LITERAL_RE.lastIndex = 0;
      let lit: RegExpExecArray | null;
      while ((lit = CODE_LITERAL_RE.exec(rhs)) !== null) codes.push(lit[1]);
      sites.push({
        file: relative(process.cwd(), file),
        line: stripped.slice(0, m.index).split("\n").length,
        codes,
      });
    }
  }
  return sites;
}

/**
 * HAND-TYPED, and deliberately NOT `[...derived]`. Oracle independence: a
 * from-disk derivation is compared to a hand-typed roster, never to a second
 * derivation, and a size pinned as `derived.size` cannot fail.
 *
 * This is the fail-loud half. A Python emitter added, removed or renamed reds
 * HERE, by name, on the day it is written — even if someone remembers to add a
 * TypeScript row at the same time.
 *
 * Measured at 140.5-02 under the predicate above: 17 distinct codes.
 */
const EXPECTED_EMITTED_CODES: readonly string[] = [
  "AUTH_FAILED",
  "CSV_FORMAT_UNSUPPORTED",
  "CSV_TOO_LARGE",
  "CSV_VALIDATION_FAILED",
  "DDOS_PROTECTION",
  "EXCHANGE_UNAVAILABLE",
  "MISSING_SCOPE",
  "MT5_MASTER_PASSWORD",
  "MT5_WRONG_SERVER",
  "NETWORK_UNAVAILABLE",
  "PERMISSION_DENIED",
  "PROBE_FAILED",
  "RATE_LIMITED",
  "TRADE_SCOPE",
  "UNSUPPORTED_EXCHANGE",
  "VALIDATION_UNEXPECTED",
  "WITHDRAW_SCOPE",
];

/**
 * HAND-TYPED VACUITY FLOOR, ~60% of the measured population, with the reason.
 *
 * `source-scan.ts`'s own docblock places this obligation on every caller: it
 * BLANKS trailing comments rather than leaving them in, so a tokenizer bug now
 * fails SILENT rather than loud. An absence assertion over an empty derivation
 * reads as protection while measuring nothing, and `it.each([])` is zero cases,
 * which is a passing suite.
 */
const DERIVED_FLOOR = 10;

describe("[140.5-02 / SEAMPROSE-03] every EMITTED Python error_code has a TypeScript disposition", () => {
  const sites = deriveEmitterSites();
  const derived = new Set(sites.flatMap((s) => s.codes));

  it("the derivation is NOT VACUOUS — population floor, with its predicate", () => {
    expect(
      derived.size,
      `Derived only ${derived.size} distinct error_code literals from ` +
        `analytics-service/services/**/*.py (floor ${DERIVED_FLOOR}). PREDICATE: ` +
        `comment-stripped via stripCommentsPreserveLines(src,"py"), then every ` +
        `bare / subscript / kwarg assignment to error_code, RHS bounded at the ` +
        `first depth-0 comma or newline, all "[A-Z][A-Z0-9_]{2,}" literals ` +
        `inside it. A number this low means the SCANNER broke, not that the ` +
        `service stopped emitting codes — and a broken scanner makes every ` +
        `assertion below pass vacuously.`,
    ).toBeGreaterThanOrEqual(DERIVED_FLOOR);
    expect(sites.length).toBeGreaterThanOrEqual(DERIVED_FLOOR);
  });

  it("the derived population matches the hand-typed roster, member for member", () => {
    // ⭐ THE FAIL-LOUD-ARRIVAL ASSERTION. Sorted arrays, not sets, so the
    // failure message NAMES what moved.
    expect([...derived].sort()).toEqual([...EXPECTED_EMITTED_CODES].sort());
  });

  it("EVERY derived code has an explicit disposition — a verdict row or a reasoned exemption", () => {
    const undisposed = [...derived]
      .filter(
        (code) =>
          !VENUE_WIRE_CODE_TO_VERDICT.has(code) &&
          !VENUE_WIRE_CODES_WITHOUT_VERDICT.has(code),
      )
      .sort();
    expect(
      undisposed,
      `These error_codes are EMITTED by analytics-service and TypeScript has ` +
        `no explicit answer for them, so they fall through the substring ` +
        `cascade to whatever an English sentence happens to earn — which is ` +
        `how MISSING_SCOPE rendered "we could not classify this failure" for a ` +
        `key scope the exchange named precisely. Add a row to ` +
        `VENUE_WIRE_CODE_TO_VERDICT, or an entry with a MEASURED reason to ` +
        `VENUE_WIRE_CODES_WITHOUT_VERDICT. Do not delete this test.`,
    ).toEqual([]);
  });

  it("no code is BOTH mapped and exempt — the two dispositions are exclusive", () => {
    const both = [...VENUE_WIRE_CODE_TO_VERDICT.keys()]
      .filter((c) => VENUE_WIRE_CODES_WITHOUT_VERDICT.has(c))
      .sort();
    expect(
      both,
      "A code with a verdict row AND an exemption reason means one of the two " +
        "is stale, and the exemption's prose is now describing behaviour the " +
        "row overrides.",
    ).toEqual([]);
  });

  it("every exemption reason is substantive, not a placeholder", () => {
    for (const [code, reason] of VENUE_WIRE_CODES_WITHOUT_VERDICT) {
      expect(reason.length, `${code}'s exemption reason is a stub`).toBeGreaterThan(
        80,
      );
      expect(reason.toLowerCase()).not.toContain("todo");
    }
  });

  it("no exempt code is a fossil — every exemption names a code that is still EMITTED", () => {
    // The mirror of the disposition check. An exemption for a code nobody emits
    // any more is dead prose accumulating in a table people trust.
    const fossils = [...VENUE_WIRE_CODES_WITHOUT_VERDICT.keys()]
      .filter((c) => !derived.has(c))
      .sort();
    expect(fossils).toEqual([]);
  });

  it("DECLARED BLIND SPOT — the dynamic emitter is SEEN, and yields no literal of its own", () => {
    // ⚠️ Stated as an ASSERTION rather than as prose, so the blind spot cannot
    // quietly widen. `csv_adapter.py`'s validation arm is the one site whose
    // code is computed (`first_rule.upper()`), and the family it opens is
    // unenumerable by any static scan. What the guard CAN hold is that this is
    // the ONLY such site: a second dynamic emitter appearing anywhere else reds
    // here rather than silently shrinking the derived population.
    const dynamicish = sites
      .filter((s) => s.codes.length === 0)
      .map((s) => `${s.file}:${s.line}`)
      .sort();
    expect(
      dynamicish,
      "An error_code assignment yielded no literal code. Either it FORWARDS a " +
        "code computed elsewhere (fine — add it below with its reason), or it " +
        "is a NEW dynamic emitter, which widens a blind spot this guard exists " +
        "to keep declared and narrow.",
    ).toEqual([
      "analytics-service/services/ingestion/binance.py:61",
      "analytics-service/services/ingestion/bybit.py:51",
      "analytics-service/services/ingestion/csv_adapter.py:152",
      "analytics-service/services/ingestion/deribit.py:70",
      "analytics-service/services/ingestion/long_fetch.py:311",
      "analytics-service/services/ingestion/mt5.py:242",
      "analytics-service/services/ingestion/okx.py:54",
      "analytics-service/services/ingestion/sfox.py:85",
    ]);
  });

  it("SELF-TEST — the scanner reads a code out of the RHS of a multi-line ternary", () => {
    // BOTH POLARITIES. The negative half is the load-bearing one: a scanner
    // narrowed until it matches nothing would satisfy every absence assertion
    // above. This is the exact shape that carries MISSING_SCOPE in exchange.py.
    const ternary = [
      'result["error_code"] = (',
      '    "TRADE_SCOPE"',
      '    if perms.get("trade")',
      '    else "MISSING_SCOPE"',
      ")",
    ].join("\n");
    ASSIGNMENT_RE.lastIndex = 0;
    const m = ASSIGNMENT_RE.exec(ternary);
    expect(m, "the assignment head was not matched at all").not.toBeNull();
    const rhs = rhsWindow(ternary, (m as RegExpExecArray).index + m![0].length);
    const found: string[] = [];
    CODE_LITERAL_RE.lastIndex = 0;
    let lit: RegExpExecArray | null;
    while ((lit = CODE_LITERAL_RE.exec(rhs)) !== null) found.push(lit[1]);
    expect(found.sort()).toEqual(["MISSING_SCOPE", "TRADE_SCOPE"]);
  });

  it("SELF-TEST — a code inside a COMMENT is not an emitter", () => {
    // DEF-16-2, live in this very tree: `exchange.py` carries
    // `error_code="MISSING_SCOPE"` inside a comment, and `long_fetch.py` carries
    // `error_code="PROBE_FAILED"` inside another. A raw grep counts both.
    const src = [
      '# at :1043 below sets error_code="COMMENT_ONLY_CODE"',
      'result["error_code"] = "REAL_CODE"',
    ].join("\n");
    const stripped = stripCommentsPreserveLines(src, "py");
    expect(stripped).not.toContain("COMMENT_ONLY_CODE");
    expect(stripped).toContain("REAL_CODE");
  });

  it("SELF-TEST — the kwarg form and the bare form are both matched, and `==` is not", () => {
    for (const shape of [
      'error_code="KWARG_CODE",',
      '    error_code = "BARE_CODE"',
      '    result["error_code"] = "SUBSCRIPT_CODE"',
    ]) {
      ASSIGNMENT_RE.lastIndex = 0;
      expect(ASSIGNMENT_RE.exec(shape), `unmatched: ${shape}`).not.toBeNull();
    }
    // NEGATIVE HALF: a COMPARISON is not an assignment. The Python test suite
    // is full of `assert result["error_code"] == "MISSING_SCOPE"`, and counting
    // those as emitters would make the population a fiction.
    ASSIGNMENT_RE.lastIndex = 0;
    expect(
      ASSIGNMENT_RE.exec('assert result["error_code"] == "MISSING_SCOPE"'),
    ).toBeNull();
  });
});
