// @vitest-environment node

import { describe, it, expect } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
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

/**
 * ⭐ Re-cut 2026-08-14 (Phase 153.7-01 / WIZFORM-02). This constant used to be
 * `SERVICES_ROOT = analytics-service/services`, and that root is the reason the
 * Phase 153 span failed WIZFORM-02: `routers/exchange.py`'s
 * `MT5_GATEWAY_UNCONFIGURED` reached a user as `code: UNKNOWN` while this guard
 * stayed green, because the scanner was not looking at `routers/` at all.
 *
 * ⛔ The boundary is "every code that can reach a user-facing surface", NOT
 * "codes emitted in a particular directory". Narrowing this back to a subtree
 * re-opens the class; the reach pin below exists to make that red by name.
 */
const ANALYTICS_ROOT = join(process.cwd(), "analytics-service");

/**
 * One recorded reason a subtree of `analytics-service/**` is NOT scanned.
 *
 * ⭐ "A guard that implies completeness it does not have is worse than none."
 * (`test_raw_5xx_census.py`, quoted deliberately.) Excluding a subtree is
 * legitimate; excluding it SILENTLY is not. Every entry below carries a
 * substantive reason — held to the same `length > 80`, no-"todo" discipline as
 * `VENUE_WIRE_CODES_WITHOUT_VERDICT` — and a hand-typed count pin measured by
 * re-running the REAL scanner with that one exclusion lifted, so widening an
 * exclusion later reds instead of quietly shrinking the population.
 */
interface ScanExclusion {
  /** Used in failure messages. */
  readonly label: string;
  /** Predicate over the path RELATIVE to the scan root, POSIX-separated. */
  readonly excludes: (relFromRoot: string) => boolean;
  /** Why, substantively. Asserted `> 80` chars and free of "todo" below. */
  readonly reason: string;
  /**
   * COUNT PIN — emitter SITES this exclusion removes, measured by re-running
   * the real scanner with only this exclusion lifted. `null` means the count is
   * machine-dependent BY CONSTRUCTION, which is itself the reason for the
   * exclusion; such an entry is pinned by hand-typed NAME instead (see
   * `LOCAL_ARTEFACT_DIRS`).
   */
  readonly removesSites: number | null;
  /** COUNT PIN — distinct codes this exclusion removes from the population. */
  readonly removesCodes: readonly string[] | null;
}

/**
 * HAND-TYPED, and hand-typed on purpose rather than a `startsWith(".")` rule: a
 * NEW artefact directory should be SCANNED and red the roster, not vanish.
 */
const LOCAL_ARTEFACT_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
]);

const SCAN_EXCLUSIONS: readonly ScanExclusion[] = [
  {
    label: "any path with a `tests` segment",
    excludes: (rel) => rel.split("/").includes("tests"),
    reason:
      "Skipped on path PARTS, not as a substring — the exact predicate " +
      "`test_raw_5xx_census.py` states in its module docstring, copied rather " +
      "than reinvented. The Python suite mints codes no user can reach: " +
      "`test_long_fetch.py` carries SOME_FUTURE_CODE and " +
      "SOME_FUTURE_UNLISTABLE_CODE, which are literally named as future-code " +
      "fixtures, and `test_process_key_200_discriminator.py` carries " +
      "CSV_PARSE_FAILED. Admitting those three fictions into a population " +
      "whose whole job is to name REAL emitters would make every disposition " +
      "written for them a lie about the service.",
    // 51 → 57 (2026-08-14, Phase 153.7-01 / WIZFORM-02). ⛔ NOTHING WAS
    // EXCLUDED — the SHAPE widened. 51 was the assignment-only delta; the call
    // scan sees six more sites, all `VenueTransientHTTPException(code=…)`
    // constructions inside `test_validate_key_venue_transient.py`. RESEARCH
    // measured ZERO `service_error*` calls under `tests/`, which was true and
    // is why the fourth callee needed its own measurement rather than an
    // inherited assumption. The code list does NOT move: that file's literals
    // are EXCHANGE_UNAVAILABLE / NETWORK_UNAVAILABLE / RATE_LIMITED, all three
    // already in the population from real emitters.
    removesSites: 57,
    removesCodes: [
      "CSV_PARSE_FAILED",
      "SOME_FUTURE_CODE",
      "SOME_FUTURE_UNLISTABLE_CODE",
    ],
  },
  {
    label: "services/error_contract.py",
    excludes: (rel) => rel === "services/error_contract.py",
    reason:
      "The DEFINITION module, not an emitter. It holds the three " +
      "`def service_error` / `def service_error_body` / " +
      "`def service_error_response` heads, one `service_error()` mention " +
      "inside an f-string raised by its own status validator, and two internal " +
      "`service_error_body(code, ...)` pass-throughs that forward a CALLER's " +
      "code. It mints no code literal of its own — and the count pin, not this " +
      "prose, is what keeps that true: the day a real literal is minted here " +
      "the pin moves and this exclusion has to be argued again.",
    // 0 → 2 (2026-08-14, Phase 153.7-01 / WIZFORM-02). ⛔ NOTHING WAS
    // EXCLUDED — the SHAPE widened. Under the assignment-only scan this file
    // removed NOTHING (it assigns no `error_code`), so the pin was honestly 0
    // and the exclusion was inert. The call scan now sees its two internal
    // `service_error_body(code, ...)` pass-throughs. ⭐ Both are LITERAL-LESS,
    // which is the measured form of Assumption A4 — "this module mints no code
    // of its own": the removed-codes list stays EMPTY, and that emptiness is
    // the whole justification for the exclusion.
    removesSites: 2,
    removesCodes: [],
  },
  {
    label: "gitignored local artefact directories",
    excludes: (rel) => rel.split("/").some((s) => LOCAL_ARTEFACT_DIRS.has(s)),
    reason:
      "Gitignored local build artefacts, enumerated by name in " +
      "LOCAL_ARTEFACT_DIRS. A developer who has run `pip install` has " +
      "thousands of third-party `.py` files under `analytics-service/.venv`; a " +
      "fresh checkout and CI have none. Scanning them would make the derived " +
      "population depend on whether a machine happens to own a virtualenv, " +
      "which is the one property a hand-typed roster cannot survive — the " +
      "roster would be green on one laptop and red on another. That " +
      "machine-dependence is exactly why this entry's count pin is null and " +
      "its oracle is the hand-typed directory-name list instead.",
    removesSites: null,
    removesCodes: null,
  },
];

/**
 * THE PREDICATE, stated in full so a count taken from this file can be
 * reproduced without reading the code:
 *
 *   For every `*.py` under `analytics-service/**` (recursive) MINUS the three
 *   recorded `SCAN_EXCLUSIONS`, strip
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

/** Which of the two minting shapes a site was found by. */
type EmitterShape = "assignment" | "call";

/** A site as the one scanner sees it, before it is given a file and a line. */
interface RawSite {
  index: number;
  shape: EmitterShape;
  /** The callee name for `shape: "call"`; `null` for assignments. */
  callee: string | null;
  codes: string[];
}

interface EmitterSite {
  file: string;
  line: number;
  shape: EmitterShape;
  codes: string[];
}

/**
 * Recursive, sorted `.py` walk with the exclusions applied to DIRECTORIES as
 * well as files, so an excluded subtree is never descended into.
 */
function pyFiles(
  dir: string,
  root: string,
  exclusions: readonly ScanExclusion[],
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (exclusions.some((x) => x.excludes(rel))) continue;
    if (entry.isDirectory()) out.push(...pyFiles(full, root, exclusions));
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

/**
 * THE SECOND MINTING SHAPE — the one whose absence is why WIZFORM-02 failed.
 *
 * `routers/exchange.py` does not assign `error_code`; it raises
 * `service_error(500, "MT5_GATEWAY_UNCONFIGURED", …)`. A scanner that knows
 * only the assignment shape cannot see a single router code, and because every
 * disposition check in this file is an ABSENCE assertion, it stays green while
 * seeing nothing. That is fail-OPEN, and it is what shipped.
 *
 * ⚠️ THE ARGUMENT SLOT IS NOT CONSTANT ACROSS CALLEES, and a single "second
 * positional argument" rule is WRONG for one of the four:
 *   · `service_error(status_code, code, *, …)`          → positional 1
 *   · `service_error_response(status_code, code, *, …)` → positional 1
 *   · `service_error_body(code, *, …)`                  → positional 0. It has
 *     NO status argument at all, so a constant rule reads its code out of the
 *     status slot and silently mints nothing.
 *   · `VenueTransientHTTPException(*, status_code, code, …)` → keyword-only, so
 *     the code is `code=`. Including this fourth shape adds ZERO codes today
 *     (its only literals are NETWORK_UNAVAILABLE and RATE_LIMITED, both already
 *     discovered by the assignment scan) and closes a live hole: a new 424
 *     venue code minted ONLY here would otherwise be invisible.
 *
 * The `"kw:code"` entries are read from the `code=` keyword; the numeric
 * entries are read from that POSITIONAL slot, falling back to a `code=` keyword
 * if the call was written in keyword form.
 */
const CALLEE_ARG_SLOT: ReadonlyMap<string, number | "kw:code"> = new Map<
  string,
  number | "kw:code"
>([
  ["VenueTransientHTTPException", "kw:code"],
  ["service_error", 1],
  ["service_error_body", 0],
  ["service_error_response", 1],
]);

const CALLEE_CALL_RE = new RegExp(
  `(?<![A-Za-z0-9_.])(${[...CALLEE_ARG_SLOT.keys()].join("|")})\\s*\\(`,
  "g",
);

/** A call argument is the code ONLY when the whole argument is one literal. */
const CALL_CODE_ARG_RE = /^["']([A-Z][A-Z0-9_]{2,})["']$/;

/** `name=value` at argument top level — `==` is a comparison, not a keyword. */
const KEYWORD_ARG_RE = /^\s*([A-Za-z_]\w*)\s*=(?!=)/;

/**
 * Which characters of `src` are inside an ORDINARY string literal.
 *
 * ⚠️ THIS IS NOT OPTIONAL, and the reason is a documented property of the
 * tokenizer this file depends on: `stripCommentsPreserveLines(src, "py")` blanks
 * `#` comments and triple-quoted strings but DELIBERATELY PRESERVES ordinary
 * string contents (`source-scan.ts`, semantics rule 2 — "a `//` inside a string
 * is not a comment"). So `f"Use service_error() for 5xx"`, which
 * `error_contract.py`'s own status validator raises, survives stripping and
 * matches a naive callee needle. Measured across this tree, in-string mentions
 * were 6 of the 9 false positives an unguarded regex produces.
 *
 * ⛔ This is an EXPRESSION-POSITION check, not a reliance on the exclusions.
 * `SCAN_EXCLUSIONS` happens to remove every in-tree case today; if this mask
 * were dropped in favour of that coincidence, the next root widening would
 * re-open the hole silently. The SELF-TEST below fixes the mask, not the
 * exclusion, as the thing being relied on.
 *
 * Triple-quoted strings are already blank, so a single-quote state machine that
 * resets at a newline is exact for what remains.
 */
function stringMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  let quote: string | null = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quote === null) {
      if (c === '"' || c === "'") {
        quote = c;
        mask[i] = 1;
      }
      continue;
    }
    mask[i] = 1;
    if (c === "\\") {
      if (i + 1 < src.length) mask[i + 1] = 1;
      i += 1;
    } else if (c === quote) {
      quote = null;
    } else if (c === "\n") {
      // Unterminated on this logical line. Reset rather than run away and
      // blank the rest of the file, which would make the scan go silent.
      quote = null;
    }
  }
  return mask;
}

/**
 * The arguments of a call whose `(` is at `openParen`, split at depth-1 commas.
 *
 * This is `rhsWindow`'s depth tracker generalised. Multi-line calls are handled
 * BY CONSTRUCTION — every production emitter in `routers/` is written one
 * argument per line across five to eight lines.
 *
 * ⛔ NO CHARACTER CAP. The Next-route matcher carries `EMITTER_BODY_MAX_CHARS`
 * because it has no bracket structure to lean on; these calls do. A cap here
 * would recreate the exact "one long `detail=` string goes invisible" failure
 * the wizardErrors invariant documents.
 *
 * Returns `null` when the call never closes — treated as literal-less by the
 * caller, so a tokenizer failure lands in the declared blind spot and reds,
 * rather than vanishing.
 */
function callArguments(
  src: string,
  mask: Uint8Array,
  openParen: number,
): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let start = openParen + 1;
  for (let i = openParen; i < src.length; i += 1) {
    if (mask[i]) continue;
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth += 1;
    else if (c === ")" || c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) {
        const last = src.slice(start, i);
        if (last.trim() !== "") args.push(last);
        return args;
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

/** The code literal a call mints, or `null` when it forwards a computed one. */
function codeArgumentOf(callee: string, args: string[]): string | null {
  const slot = CALLEE_ARG_SLOT.get(callee)!;
  const positional: string[] = [];
  const keywords = new Map<string, string>();
  for (const arg of args) {
    const kw = KEYWORD_ARG_RE.exec(arg);
    if (kw) keywords.set(kw[1], arg.slice(arg.indexOf("=", kw.index) + 1));
    else positional.push(arg);
  }
  const raw =
    slot === "kw:code"
      ? keywords.get("code")
      : (positional[slot] ?? keywords.get("code"));
  if (raw === undefined) return null;
  const lit = CALL_CODE_ARG_RE.exec(raw.trim());
  return lit ? lit[1] : null;
}

/**
 * THE ONE SCANNER, exercised by BOTH the disk walk and every SELF-TEST below.
 * A self-test that ran a second copy of this logic would prove nothing about
 * the scanner that produces the census (`test_raw_5xx_census.py`'s rule,
 * adopted verbatim).
 *
 * Input is ALREADY comment-stripped. Output preserves MULTIPLICITY: a site
 * whose code argument is not a literal yields `codes: []` and is counted into
 * the declared blind spot rather than dropped.
 */
function scanStrippedSource(stripped: string): RawSite[] {
  const sites: RawSite[] = [];
  ASSIGNMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ASSIGNMENT_RE.exec(stripped)) !== null) {
    const rhs = rhsWindow(stripped, m.index + m[0].length);
    const codes: string[] = [];
    CODE_LITERAL_RE.lastIndex = 0;
    let lit: RegExpExecArray | null;
    while ((lit = CODE_LITERAL_RE.exec(rhs)) !== null) codes.push(lit[1]);
    sites.push({ index: m.index, shape: "assignment", callee: null, codes });
  }

  const mask = stringMask(stripped);
  CALLEE_CALL_RE.lastIndex = 0;
  let call: RegExpExecArray | null;
  while ((call = CALLEE_CALL_RE.exec(stripped)) !== null) {
    // GUARD 1 — an in-string MENTION is not a call. See stringMask's docblock.
    if (mask[call.index]) continue;
    // GUARD 2 — a DEFINITION is not a call, and that means `class` as well as
    // `def`. `def service_error(` in error_contract.py is 3 of the 9 measured
    // false positives, and the exclusion of that file is not what this relies
    // on.
    // ⭐ `class` was NOT in the researched false-positive census, and it was
    // caught by the mandatory cross-check against the independent Python AST
    // census rather than by review: `class VenueTransientHTTPException(
    // HTTPException):` is a class-definition head, `ast` does not report it as
    // a Call, and the two derivations disagreed 3 vs 2. The census enumerated
    // `def` because it was run over the three `service_error*` names, where
    // `class` can never precede — adding a CLASS callee added a hazard class
    // with it. That disagreement is the reason this guard is two words wide.
    if (
      /\b(?:def|class)\s+$/.test(
        stripped.slice(Math.max(0, call.index - 24), call.index),
      )
    )
      continue;
    const callee = call[1];
    const args = callArguments(stripped, mask, call.index + call[0].length - 1);
    const code = args === null ? null : codeArgumentOf(callee, args);
    sites.push({
      index: call.index,
      shape: "call",
      callee,
      // MULTIPLICITY AND BLIND SPOTS PRESERVED: a forwarded, computed code
      // yields `[]` and is COUNTED into dynamicishByFile, never dropped.
      // Dropping it would let a future dynamic router code shrink the
      // population without reddening anything.
      codes: code === null ? [] : [code],
    });
  }

  return sites.sort((a, b) => a.index - b.index);
}

/**
 * ⭐ `root` is a PARAMETER, not a closed-over module constant, and that is the
 * prerequisite for the whole-pipeline falsifier below: the guard is proved to
 * red for a NEW undisposed router code by running THIS function over a
 * synthetic tree, never a second copy of it.
 */
function deriveEmitterSites(
  root: string,
  exclusions: readonly ScanExclusion[] = SCAN_EXCLUSIONS,
): EmitterSite[] {
  const sites: EmitterSite[] = [];
  for (const file of pyFiles(root, root, exclusions)) {
    // ⚠️ COMMENT-STRIP BEFORE COUNTING (DEF-16-2). Two `error_code="…"`
    // occurrences in this very tree live inside comments — one of them names
    // MISSING_SCOPE — and a raw scan would count both as emitters.
    const stripped = stripCommentsPreserveLines(readFileSync(file, "utf-8"), "py");
    for (const raw of scanStrippedSource(stripped)) {
      sites.push({
        file: relative(process.cwd(), file),
        line: stripped.slice(0, raw.index).split("\n").length,
        shape: raw.shape,
        codes: raw.codes,
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
  const sites = deriveEmitterSites(ANALYTICS_ROOT);
  const derived = new Set(sites.flatMap((s) => s.codes));

  it("the derivation is NOT VACUOUS — population floor, with its predicate", () => {
    expect(
      derived.size,
      `Derived only ${derived.size} distinct error_code literals from ` +
        `analytics-service/**/*.py minus SCAN_EXCLUSIONS (floor ` +
        `${DERIVED_FLOOR}). PREDICATE: ` +
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

  it("every SCAN EXCLUSION reason is substantive, not a placeholder", () => {
    // The same discipline VENUE_WIRE_CODES_WITHOUT_VERDICT is held to, applied
    // to the OTHER way a code can go missing. A silent exclusion and a
    // placeholder exemption are the same defect pointed at different halves.
    for (const x of SCAN_EXCLUSIONS) {
      expect(
        x.reason.length,
        `${x.label}'s exclusion reason is a stub`,
      ).toBeGreaterThan(80);
      expect(x.reason.toLowerCase()).not.toContain("todo");
    }
  });

  it("every SCAN EXCLUSION is PINNED by what it removes — measured, not asserted", () => {
    // ⭐ Mechanism 2 of the three RESEARCH Q6 names, and the one that makes an
    // exclusion falsifiable: re-run the REAL scanner with exactly ONE exclusion
    // lifted and pin the delta. Prose says "it mints nothing"; this says it and
    // reds the day it stops being true. `EXPECTED_NON_LITERAL_STATUS_SITES` in
    // test_raw_5xx_census.py is the precedent.
    const baseline = deriveEmitterSites(ANALYTICS_ROOT);
    for (const x of SCAN_EXCLUSIONS) {
      if (x.removesSites === null) {
        // Pinned by NAME instead — see LOCAL_ARTEFACT_DIRS and the reason.
        expect(x.removesCodes, `${x.label} half-pinned`).toBeNull();
        continue;
      }
      const lifted = deriveEmitterSites(
        ANALYTICS_ROOT,
        SCAN_EXCLUSIONS.filter((o) => o !== x),
      );
      const newCodes = [
        ...new Set(lifted.flatMap((s) => s.codes)),
      ]
        .filter((c) => !baseline.some((s) => s.codes.includes(c)))
        .sort();
      expect(
        {
          sites: lifted.length - baseline.length,
          codes: newCodes,
        },
        `Lifting the "${x.label}" exclusion no longer removes what its pin ` +
          `claims. If the subtree GREW an emitter, the exclusion now hides ` +
          `something real and has to be argued again — do not bump the pin to ` +
          `make this pass. If it SHRANK, say so in the reason.`,
      ).toEqual({ sites: x.removesSites, codes: [...x.removesCodes!] });
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
    // ⭐ Re-cut 2026-08-10. This assertion used to pin bare `file:line` pairs —
    // the SAME stale-coordinate defect that `seam-citations.invariant.test.ts`
    // exists to ban in comments, reproduced inside an assertion. It went red
    // because Phase 153.3 legitimately edited `mt5.py` and the site moved
    // 242 → 363. Nothing about the blind spot changed; only an address did.
    //
    // ⛔ Bumping the integer would re-arm the same trap, so the oracle is now
    // file → COUNT. It keeps every bit of the guard's power — a new dynamic
    // emitter in a NEW file reds (new key), and a SECOND one in an
    // already-listed file also reds (count changes) — while being immune to
    // code moving up or down within a file, which is not a fact worth failing on.
    const dynamicishByFile: Record<string, number> = {};
    for (const s of sites.filter((x) => x.codes.length === 0)) {
      dynamicishByFile[s.file] = (dynamicishByFile[s.file] ?? 0) + 1;
    }
    expect(
      dynamicishByFile,
      "An error_code assignment yielded no literal code. Either it FORWARDS a " +
        "code computed elsewhere (fine — add it below with its reason), or it " +
        "is a NEW dynamic emitter, which widens a blind spot this guard exists " +
        "to keep declared and narrow. Counts are per file: a second dynamic " +
        "emitter inside an already-listed file reds here too.",
    //
    // 8 → 10 keys (2026-08-14, Phase 153.7-01 / WIZFORM-02). ⛔ NO BLIND SPOT
    // WIDENED — the ROOT moved from `analytics-service/services` to
    // `analytics-service`, and the only two `error_code =` assignments that
    // live outside `services/` are both literal-less FORWARDS of a code
    // computed inside `services/`: `cron.py` reads `validation.get(…)` and
    // `process_key.py` reads `val.error_code`. Neither mints a code, which is
    // why the derived population is UNCHANGED by the root move and only this
    // pin records it. If a root widening ever moves the population instead of
    // this pin, an exclusion is wrong — stop and re-measure.
    ).toEqual({
      "analytics-service/routers/cron.py": 1,
      "analytics-service/routers/process_key.py": 1,
      "analytics-service/services/ingestion/binance.py": 1,
      "analytics-service/services/ingestion/bybit.py": 1,
      "analytics-service/services/ingestion/csv_adapter.py": 1,
      "analytics-service/services/ingestion/deribit.py": 1,
      "analytics-service/services/ingestion/long_fetch.py": 1,
      "analytics-service/services/ingestion/mt5.py": 1,
      "analytics-service/services/ingestion/okx.py": 1,
      "analytics-service/services/ingestion/sfox.py": 1,
    });
  });

  /** The ONE scanner, over a source string. Never a second copy of the logic. */
  const scanFixture = (src: string) =>
    scanStrippedSource(stripCommentsPreserveLines(src, "py"));

  it("SELF-TEST — a multi-line `service_error(status, CODE, …)` call is read, and a `def` of it is not", () => {
    // BOTH POLARITIES. The positive half is the exact shape that carries
    // MT5_GATEWAY_UNCONFIGURED in exchange.py, written one argument per line
    // across six lines; the negative half is the definition head in
    // error_contract.py. ⚠️ The negative half does NOT lean on that file's
    // exclusion — this fixture has no path at all, so what is being proved is
    // the `def` guard itself.
    const raised = scanFixture(
      [
        "        raise service_error(",
        "            500,",
        '            "MT5_GATEWAY_UNCONFIGURED",',
        '            dependency="mt5-gateway",',
        "            retryable=False,",
        '            detail="The MetaTrader gateway is not configured. This needs an operator, not a retry.",',
        "        )",
      ].join("\n"),
    );
    expect(raised.map((s) => s.codes)).toEqual([["MT5_GATEWAY_UNCONFIGURED"]]);
    expect(raised.map((s) => s.shape)).toEqual(["call"]);

    // NEGATIVE HALF: the definition mints nothing. A scanner that counted it
    // would put the parameter NAME, or the first thing that looks like a code,
    // into a population that is supposed to name real emitters.
    expect(
      scanFixture(
        [
          "def service_error(",
          "    status_code: int,",
          "    code: str,",
          "    *,",
          "    retryable: bool,",
          ") -> HTTPException:",
        ].join("\n"),
      ),
    ).toEqual([]);

    // ⭐ AND THE OTHER DEFINITION KEYWORD. The fourth callee is a CLASS, so
    // `class VenueTransientHTTPException(HTTPException):` is a definition head
    // that looks exactly like a call with one positional argument. This case
    // was NOT in the researched false-positive census — it was found by the
    // cross-check against the independent Python AST census, which reports no
    // Call node here, and it is why the guard says `def|class` rather than
    // `def`. A regression here is silent: the site yields no literal, so it
    // lands in the blind-spot pin and reads as an honest dynamic emitter.
    expect(
      scanFixture("class VenueTransientHTTPException(HTTPException):"),
    ).toEqual([]);
  });

  it("SELF-TEST — a callee name inside a STRING literal is a mention, not a call", () => {
    // ⚠️ THE LOAD-BEARING NEGATIVE. `stripCommentsPreserveLines(src,"py")`
    // deliberately PRESERVES ordinary string contents, so this sentence — which
    // error_contract.py's status validator really raises — survives stripping
    // and matches a naive needle. 6 of the 9 measured false positives are this
    // class. What rejects it is `stringMask`, an expression-position check;
    // the exclusion of error_contract.py is a SECOND, independent reason and is
    // deliberately not what this asserts.
    expect(
      scanFixture(
        'raise ValueError(f"Use service_error() for 5xx. got {status_code!r}")',
      ),
    ).toEqual([]);
    // ...and a `detail=` string that happens to contain an UPPER_SNAKE word is
    // not a code either: the code argument must be the WHOLE argument.
    expect(
      scanFixture(
        'raise service_error(500, "REAL_CODE", detail="not a DECOY_CODE here")',
      ).flatMap((s) => s.codes),
    ).toEqual(["REAL_CODE"]);
  });

  it("SELF-TEST — every CALLEE_ARG_SLOT member reads the code from ITS OWN slot", () => {
    // ⚠️ One fixture per member, because the slot is not constant. The
    // `service_error_body` case is the trap: it takes the code FIRST, so a
    // constant "second positional" rule reads `retryable=` or nothing at all.
    const fixtures: [string, string, string][] = [
      ["service_error", 'raise service_error(500, "POSITIONAL_ONE", retryable=False)', "POSITIONAL_ONE"],
      [
        "service_error_response",
        'return service_error_response(424, "RESPONSE_ONE", retryable=True)',
        "RESPONSE_ONE",
      ],
      [
        "service_error_body",
        'body = service_error_body("CODE_FIRST", retryable=False, detail="x")',
        "CODE_FIRST",
      ],
      [
        "VenueTransientHTTPException",
        'raise VenueTransientHTTPException(status_code=424, code="KEYWORD_ONLY", recoverable=True)',
        "KEYWORD_ONLY",
      ],
    ];
    expect(
      fixtures.map(([callee]) => callee).sort(),
      "a callee was added to or dropped from CALLEE_ARG_SLOT without a slot " +
        "fixture — the slot is the thing most likely to be silently wrong",
    ).toEqual([...CALLEE_ARG_SLOT.keys()].sort());
    for (const [callee, src, expected] of fixtures) {
      expect(
        scanFixture(src).flatMap((s) => s.codes),
        `${callee} did not read its code out of slot ` +
          `${String(CALLEE_ARG_SLOT.get(callee))}`,
      ).toEqual([expected]);
    }
    // NEGATIVE HALF: reading `service_error_body` as if it were
    // `service_error` would find the code in the SECOND argument. It must not.
    expect(
      scanFixture('body = service_error_body("CODE_FIRST", detail="SECOND_SLOT_DECOY")')
        .flatMap((s) => s.codes),
    ).toEqual(["CODE_FIRST"]);
  });

  it("SELF-TEST — a call that FORWARDS a computed code is counted, not dropped", () => {
    // The `Counter`-not-`frozenset` discipline. A forwarded code yields no
    // literal, and the site still has to appear — in dynamicishByFile — or a
    // future dynamic router code shrinks the population in silence. Both live
    // shapes: a subscript forward and a dict-lookup forward.
    const forwards = scanFixture(
      [
        "        raise VenueTransientHTTPException(",
        "            status_code=424,",
        '            code=validation["error_code"],',
        "        )",
        "        raise service_error(500, result.error_code, retryable=False)",
      ].join("\n"),
    );
    expect(forwards.map((s) => s.shape)).toEqual(["call", "call"]);
    expect(
      forwards.map((s) => s.codes),
      "a literal-less code argument must yield a SITE with no codes, never no " +
        "site at all",
    ).toEqual([[], []]);
  });

  it("SELF-TEST — the `tests` exclusion skips a fixture code, and the SAME content outside it is read", () => {
    // BOTH POLARITIES, and the NEGATIVE half is the load-bearing one: an
    // exclusion predicate written as a SUBSTRING (`rel.includes("tests")`)
    // would also swallow a real `services/backtests/…` emitter, and every
    // absence assertion in this file would stay green while the population
    // silently shrank. So the positive half — "the same bytes OUTSIDE a
    // `tests` segment still yield the code" — is what proves the rule is
    // scoped to a path SEGMENT and not to a name fragment.
    const tmp = mkdtempSync(join(tmpdir(), "seam-venue-exclusion-"));
    try {
      const body = 'error_code = "SOME_FUTURE_CODE"\n';
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(join(tmp, "tests", "test_fixture.py"), body);
      mkdirSync(join(tmp, "services", "backtests"), { recursive: true });
      writeFileSync(join(tmp, "services", "backtests", "real.py"), body);

      const found = deriveEmitterSites(tmp);
      expect(
        found.map((s) => s.file.split(sep).slice(-2).join("/")).sort(),
        "the `tests` SEGMENT rule must skip tests/test_fixture.py and KEEP " +
          "services/backtests/real.py — a substring rule drops both",
      ).toEqual(["backtests/real.py"]);
      expect(found.flatMap((s) => s.codes)).toEqual(["SOME_FUTURE_CODE"]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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
