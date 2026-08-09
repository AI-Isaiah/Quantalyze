// @vitest-environment node

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripCommentsPreserveLines } from "./source-scan";

/**
 * Phase 142.2-07 / MT5-04 (D-05) — A WIZARD ERROR CODE IS INERT UNLESS IT LANDS
 * IN ALL THREE REGISTRIES.
 *
 * ── WHAT THIS FILE EXISTS TO STOP ───────────────────────────────────────────
 *
 * A code a route puts on the wire has to clear three independent hand-typed
 * registries before a user sees its copy:
 *
 *   1. the `WizardErrorCode` union in `wizardErrors.ts` (and, with it, the
 *      `WIZARD_ERROR_COPY` record, which TypeScript makes total over the union);
 *   2. `KNOWN_CREATE_WITH_KEY_CODES` in `ConnectKeyStep.tsx`, for codes from
 *      `strategies/create-with-key`;
 *   3. `KNOWN_ADD_KEY_CODES` in `MultiKeyConnectStep.tsx`, for codes from
 *      `strategies/composite/add-key`.
 *
 * Miss the union and the code cannot be typed. Miss the ROSTER and the code
 * type-checks, ships, and is then rejected at the step as unrecognised — it
 * renders `UNKNOWN` ("We could not classify this failure"). That failure is
 * SILENT: nothing reddens, the copy exists, and the user gets the fallback.
 * 142.2-07 minted four codes at once, so the drift window was four times the
 * usual size, and the whole point of the plan was to stop rendering a sentence
 * that is not true of the user's situation. Landing on `UNKNOWN` would have
 * replaced a wrong sentence with a vaguer one.
 *
 * ⚠️ THE TWO ROSTERS ARE DELIBERATELY SEPARATE, and this guard does not
 * second-guess that. `ConnectKeyStep.tsx`'s docblock argues at length that a
 * step should admit the codes ITS route emits and not the whole vocabulary.
 * So the assertion is per-route — create-with-key's emitters against
 * create-with-key's roster — never a merged set. A merged check would pass
 * while each roster silently admitted the other route's codes.
 *
 * ── HONEST STATEMENT OF WHAT IT IS ──────────────────────────────────────────
 *
 * The registries stay hand-typed rosters; this does not promote them to a
 * derived single source. What it adds is FAIL-LOUD ARRIVAL: the population is
 * derived from the real emitters on disk, so a code emitted by a route and
 * missing from a registry reddens CI by name.
 *
 * ⚠️ COMMENT-STRIP BEFORE COUNTING, and this phase is the receipt for why.
 * `grep -c 'KEY_INVALID_FORMAT'` on each route returns **14**;
 * `grep -c 'code: "KEY_INVALID_FORMAT"'` returns **12**. The two-per-file delta
 * is COMMENT PROSE describing the MT5 short-login carve-out. The phase's own
 * research documents recorded 14 + 14 = 28 sites, and a plan built on that
 * number would have hunted four emitters that do not exist. Every count below
 * is taken from `stripCommentsPreserveLines` output, and the SELF-TESTs at the
 * bottom prove the scanner really does drop a commented mention.
 */

const REPO = process.cwd();

const UNION_SOURCE = join(REPO, "src", "lib", "wizardErrors.ts");
const WIZARD_STEPS = join(
  REPO,
  "src",
  "app",
  "(dashboard)",
  "strategies",
  "new",
  "wizard",
  "steps",
);

/**
 * THE EMITTER PREDICATE, stated in full so any count below can be reproduced
 * without reading this code:
 *
 *   Take the route's source and strip comments and docstrings with
 *   `stripCommentsPreserveLines(src, "ts")`. A REJECTION-EMITTING SITE is a
 *   `NextResponse.json(` call whose FIRST argument is an object literal opening
 *   with `code: "<UPPER_SNAKE_LITERAL>"` immediately followed by an `error:`
 *   key, and whose SECOND argument carries `status: 400`. The emitted code is
 *   that string literal.
 *
 * Three things this deliberately EXCLUDES, each verified against the real
 * sources rather than assumed:
 *
 *   · The rate-limiter deny bodies. `rateLimitDenyJson(...)` receives
 *     `throttledBody: { code: "KEY_RATE_LIMIT", ... }` and
 *     `misconfiguredBody: { code: "SEAM_MISCONFIGURED", ... }`. Both are object
 *     literals of the same SHAPE, but neither is the first argument of a
 *     `NextResponse.json(` call, and their status is decided inside the helper.
 *   · The read-only permission refusal, which is also a 400 but passes the
 *     SHORTHAND `{ code }` — a computed value, no string literal, and no
 *     `error` key (it is uniform-`{ code }` by H-0305). Excluded by the
 *     literal requirement, which is why the count is 12 and not 13.
 *   · Every non-400 answer (409/403/500/502/503 and the 200 path).
 *
 * The population is therefore exactly the INPUT-VALIDATION rejections — the
 * guards that run before the limiter and before any live probe, which is the
 * class MT5-04 split.
 */
const EMITTER_RE =
  /NextResponse\.json\(\s*\{\s*code:\s*"([A-Z][A-Z0-9_]*)"\s*,\s*error:[^}]*\}\s*,\s*\{[^}]*status:\s*400/g;

interface RouteUnderTest {
  /** Human name used in failure messages. */
  readonly label: string;
  /** Path to the route handler, relative to the repo root. */
  readonly route: string;
  /** Path to the file holding the roster this route's codes must clear. */
  readonly rosterFile: string;
  /** The roster's declared name. */
  readonly rosterName: string;
}

const ROUTES: readonly RouteUnderTest[] = [
  {
    label: "create-with-key",
    route: join(REPO, "src/app/api/strategies/create-with-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
    rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
  },
  {
    label: "composite/add-key",
    route: join(REPO, "src/app/api/strategies/composite/add-key/route.ts"),
    rosterFile: join(WIZARD_STEPS, "MultiKeyConnectStep.tsx"),
    rosterName: "KNOWN_ADD_KEY_CODES",
  },
];

function stripped(path: string): string {
  return stripCommentsPreserveLines(readFileSync(path, "utf-8"), "ts");
}

/** Every rejection-emitted code literal, in source order, WITH repeats. */
function deriveEmittedCodes(source: string): string[] {
  const out: string[] = [];
  EMITTER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMITTER_RE.exec(source)) !== null) out.push(m[1]);
  return out;
}

/**
 * The `WizardErrorCode` union's members, read out of its declaration.
 *
 * Bounded at the declaration's terminating `;` so the scan cannot wander into
 * `WIZARD_ERROR_COPY` below it and read the record's KEYS as if they were union
 * members. The two agree today (TypeScript makes the record total over the
 * union), and that is exactly why reading the wrong one would be invisible.
 */
function deriveUnionMembers(source: string): string[] {
  const start = source.indexOf("export type WizardErrorCode =");
  if (start < 0) return [];
  const end = source.indexOf(";", start);
  const block = source.slice(start, end < 0 ? source.length : end);
  return [...block.matchAll(/\|\s*"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

/**
 * The string literals inside a `const <name> ... new Set<...>([ ... ])`.
 *
 * ⚠️ THE ANCHORS ARE WHITESPACE-TOLERANT, AND THAT IS THE WHOLE POINT.
 * Until 153.1-01 this function searched for the two-character strings `"(["`
 * and `"])"`, which require the bracket to be ADJACENT to the paren. Both
 * incumbent rosters wrap after the `=` (`ConnectKeyStep.tsx:265`,
 * `MultiKeyConnectStep.tsx:214`) so their `([` really is adjacent — which is
 * why nobody hit this. `SubmitStep.tsx:230` wraps INSIDE the call instead
 * (`new Set<WizardErrorCode>(` at end of line, `[` on the next), so
 * `indexOf("([")` returned -1 and the roster derived to `[]` — measured by
 * execution 2026-08-09. An empty derivation satisfies every "the missing set is
 * empty" assertion in this file, so the guard would have been BORN BLIND on
 * that route and passed green.
 *
 * ⛔ REFORMATTING THE SUBJECT IS NOT THE FIX. Joining `SubmitStep.tsx`'s
 * declaration onto one line makes it ~93 characters, Prettier re-breaks it, and
 * the next `npm run lint -- --fix` silently re-blinds the scanner. Fixing the
 * SCANNER is the class fix; reformatting the file it happens to be pointed at
 * is the instance fix.
 *
 * The contract is otherwise unchanged: bounded to the NAMED declaration,
 * returns `[]` when either anchor is missing, and extracts UPPER_SNAKE string
 * literals only. The closing anchor tolerates the trailing comma that a
 * multi-line argument list carries (`],` then `);`), and both anchors take
 * their FIRST match, so the scan still stops at this roster's own close and
 * cannot run on into the next `const KNOWN_*` set — pinned by the two SELF-TESTs
 * at the bottom of this file.
 */
function deriveRoster(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  const open = openMatch.index;
  const closeMatch = /\]\s*,?\s*\)/.exec(tail.slice(open));
  if (closeMatch === null) return [];
  const block = tail.slice(open, open + closeMatch.index);
  return [...block.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}

/**
 * HAND-TYPED LITERAL COUNTS. Measured at 142.2-07 under the predicate above.
 *
 * ⚠️ PINNED AS LITERALS, NEVER AS `derived.length`. A size compared against its
 * own derivation cannot fail: delete every guard in the route and both sides go
 * to zero together. This is the Oracle-Independence rule the phase's validation
 * contract makes explicit, and it has a live precedent on this codebase — three
 * money bugs survived six review passes behind self-referential oracles.
 *
 * ⚠️ AND THE NUMBER IS 12, NOT 14. 14 is what a raw `grep -c KEY_INVALID_FORMAT`
 * reported before the split, and two of those 14 per file are comment prose.
 * Pinning 14 here would make this guard assert a fiction and demand two
 * emitters nobody can write.
 */
const EXPECTED_SITES_PER_ROUTE = 12;

/**
 * After the split, exactly ONE guard per route may still answer
 * `KEY_INVALID_FORMAT`: the ccxt `api_secret.length < 8` arm, the only one of
 * the twelve that judges the SHAPE of a value. Its copy (Binance secrets are 64
 * hex characters, …) is true of that guard and was false of the other eleven.
 */
const EXPECTED_FORMAT_EMITTERS_PER_ROUTE = 1;

/**
 * HAND-TYPED VACUITY FLOOR on the combined derivation (24 sites measured),
 * with the reason.
 *
 * `source-scan.ts`'s own docblock places this obligation on every caller: it
 * BLANKS trailing comments rather than leaving them in, so a tokenizer bug now
 * fails SILENT rather than loud. An "every emitted code is in its registry"
 * assertion over an EMPTY derivation is green forever while measuring nothing,
 * and `it.each([])` is zero cases, which is a passing suite. ~60% of 24.
 */
const DERIVED_FLOOR = 14;

/**
 * HAND-TYPED. The four codes 142.2-07 minted, and the one it left in place.
 * Compared against a from-disk derivation, never against a second derivation.
 */
const EXPECTED_SPLIT_CODES: readonly string[] = [
  "KEY_INPUT_TOO_LONG",
  "KEY_INVALID_FORMAT",
  "KEY_MISSING_REQUIRED_FIELD",
  "KEY_UNSUPPORTED_VENUE",
  "KEY_VENUE_NOT_ENABLED",
];

describe("[142.2-07 / MT5-04] every emitted wizard code clears the union AND its route's roster", () => {
  const unionSource = stripped(UNION_SOURCE);
  const union = new Set(deriveUnionMembers(unionSource));

  const derived = ROUTES.map((r) => {
    const rosterSource = stripped(r.rosterFile);
    return {
      ...r,
      codes: deriveEmittedCodes(stripped(r.route)),
      roster: new Set(deriveRoster(rosterSource, r.rosterName)),
    };
  });

  it("the derivation is NOT VACUOUS — population floor, with its predicate", () => {
    const total = derived.reduce((n, d) => n + d.codes.length, 0);
    expect(
      total,
      `Derived only ${total} rejection-emitting sites across the two wizard ` +
        `routes (floor ${DERIVED_FLOOR}). PREDICATE: comment-stripped via ` +
        `stripCommentsPreserveLines(src,"ts"), then every NextResponse.json( ` +
        `call whose first argument is { code: "<LITERAL>", error: … } and ` +
        `whose second carries status: 400. A number this low means the SCANNER ` +
        `broke, not that the routes stopped validating input — and a broken ` +
        `scanner makes every assertion below pass vacuously.`,
    ).toBeGreaterThanOrEqual(DERIVED_FLOOR);

    // Both sides of every comparison must have parsed, not just the emitters.
    expect(union.size, "the WizardErrorCode union parsed as empty").toBeGreaterThan(
      30,
    );
    for (const d of derived) {
      expect(d.roster.size, `${d.rosterName} parsed as empty`).toBeGreaterThan(10);
    }
  });

  it.each(ROUTES.map((r) => r.label))(
    "%s: the site count is the LITERAL 12 — not 14, and not its own length",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      expect(
        d.codes.length,
        `${label} has ${d.codes.length} rejection-emitting sites under the ` +
          `predicate in this file's header; ${EXPECTED_SITES_PER_ROUTE} were ` +
          `measured at 142.2-07. If a guard was ADDED, give it an honest code ` +
          `and bump this literal. If one was REMOVED, a validation guard just ` +
          `disappeared, which is a bigger question than this test.`,
      ).toBe(EXPECTED_SITES_PER_ROUTE);
    },
  );

  it.each(ROUTES.map((r) => r.label))(
    "%s: every emitted code is a member of the WizardErrorCode union",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      const missing = [...new Set(d.codes)].filter((c) => !union.has(c)).sort();
      expect(
        missing,
        `${label} emits codes that are not in the WizardErrorCode union, so ` +
          `WIZARD_ERROR_COPY has no entry for them and formatKeyError falls ` +
          `through to UNKNOWN.`,
      ).toEqual([]);
    },
  );

  it.each(ROUTES.map((r) => r.label))(
    "%s: every emitted code is admitted by THAT ROUTE's roster",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      const missing = [...new Set(d.codes)].filter((c) => !d.roster.has(c)).sort();
      expect(
        missing,
        `${label} emits codes that ${d.rosterName} does not admit. The step ` +
          `rejects an unrecognised code and renders UNKNOWN — silently, with ` +
          `nothing else reddening. Add each code to ${d.rosterName}. Do NOT ` +
          `merge the two rosters to make this pass: they are separate on ` +
          `purpose (see ConnectKeyStep's docblock), and a merged set would ` +
          `admit each route's codes at the other.`,
      ).toEqual([]);
    },
  );

  it.each(ROUTES.map((r) => r.label))(
    "%s: KEY_INVALID_FORMAT survives at exactly ONE guard — the ccxt short-secret arm",
    (label) => {
      const d = derived.find((x) => x.label === label)!;
      const n = d.codes.filter((c) => c === "KEY_INVALID_FORMAT").length;
      expect(
        n,
        `${label} answers KEY_INVALID_FORMAT at ${n} guards; exactly ` +
          `${EXPECTED_FORMAT_EMITTERS_PER_ROUTE} is correct. More than one ` +
          `means a cause that is not a format failure has been folded back ` +
          `into the bucket this phase split — and its copy ("Binance secrets ` +
          `are 64 hex characters") becomes false again for that cause. Zero ` +
          `means the one genuine format guard lost its code.`,
      ).toBe(EXPECTED_FORMAT_EMITTERS_PER_ROUTE);
    },
  );

  it("the two routes emit the SAME set of codes — they are structural mirrors", () => {
    // Not a tautology: the routes are separate files with separate guards, and
    // the phase's stated risk is fixing one and leaving the other. A divergence
    // here means a guard was edited on one side only.
    const [a, b] = derived;
    expect([...new Set(a.codes)].sort()).toEqual([...new Set(b.codes)].sort());
  });

  it("the emitted vocabulary is the hand-typed split set — no more, no less", () => {
    const all = new Set(derived.flatMap((d) => d.codes));
    expect(
      [...all].sort(),
      "The set of codes these two routes put on the wire changed. If a code " +
        "was added, it needs a copy entry and a roster row; if one vanished, " +
        "a cause silently merged back into another.",
    ).toEqual([...EXPECTED_SPLIT_CODES].sort());
  });

  it("SELF-TEST — the scanner reads a code out of real emitter syntax", () => {
    // The POSITIVE half, and the load-bearing one: a regex narrowed until it
    // matches nothing satisfies every "missing is empty" assertion above.
    const real = [
      "    return NextResponse.json(",
      '      { code: "REAL_CODE", error: "something is required" },',
      "      { status: 400, headers: NO_STORE_HEADERS },",
      "    );",
    ].join("\n");
    expect(deriveEmittedCodes(real)).toEqual(["REAL_CODE"]);
  });

  it("SELF-TEST — a code inside a COMMENT is not an emitter (the 14-vs-12 lesson)", () => {
    // ⚠️ THIS IS THE EXACT DEFECT THAT PRODUCED THIS PHASE'S WRONG SITE COUNT.
    // Both wizard routes carry comment prose naming KEY_INVALID_FORMAT — the
    // MT5 short-login carve-out explains which rejection it avoids — so a raw
    // grep returned 14 per file where only 12 are emitters. The research
    // documents recorded 28 sites; the truth is 24.
    const src = [
      '    // the ccxt venues keep the KEY_INVALID_FORMAT rejection below',
      "    return NextResponse.json(",
      '      { code: "REAL_CODE", error: "x" },',
      "      { status: 400, headers: NO_STORE_HEADERS },",
      "    );",
    ].join("\n");
    const out = stripCommentsPreserveLines(src, "ts");
    expect(out).not.toContain("KEY_INVALID_FORMAT");
    expect(out).toContain("REAL_CODE");
    expect(deriveEmittedCodes(out)).toEqual(["REAL_CODE"]);
  });

  it("SELF-TEST — the excluded shapes really are excluded", () => {
    // The shorthand 400 (`{ code }`, no literal, no error key) and the
    // limiter's nested deny bodies. If either started matching, the site count
    // would move for a reason that has nothing to do with input validation,
    // and someone would 'fix' the literal 12 to cover it.
    const shorthand = [
      "      return NextResponse.json(",
      "        { code },",
      "        { status: 400, headers: NO_STORE_HEADERS },",
      "      );",
    ].join("\n");
    expect(deriveEmittedCodes(shorthand)).toEqual([]);

    const denyBodies = [
      "    return rateLimitDenyJson(rl, {",
      "      headers: NO_STORE_HEADERS,",
      '      throttledBody: { code: "KEY_RATE_LIMIT", error: "Too many requests" },',
      "      misconfiguredBody: {",
      '        code: "SEAM_MISCONFIGURED",',
      '        error: "Rate limiter unavailable",',
      "      },",
      "    });",
    ].join("\n");
    expect(deriveEmittedCodes(denyBodies)).toEqual([]);
  });

  it("SELF-TEST — the union scan stops at the declaration, not at the copy table", () => {
    const fake = [
      'export type WizardErrorCode =',
      '  | "UNION_MEMBER"',
      '  | "UNKNOWN";',
      "",
      "const WIZARD_ERROR_COPY = {",
      '  NOT_A_UNION_MEMBER: { title: "x" },',
      "};",
    ].join("\n");
    expect(deriveUnionMembers(fake)).toEqual(["UNION_MEMBER", "UNKNOWN"]);
  });

  it("SELF-TEST — the roster scan reads the named Set and stops at its close", () => {
    const fake = [
      "const KNOWN_ADD_KEY_CODES: ReadonlySet<WizardErrorCode> =",
      "  new Set<WizardErrorCode>([",
      '    "IN_ROSTER",',
      '    "ALSO_IN_ROSTER",',
      "  ]);",
      "",
      "const KNOWN_OTHER_CODES: ReadonlySet<WizardErrorCode> =",
      "  new Set<WizardErrorCode>([",
      '    "IN_THE_OTHER_ONE",',
      "  ]);",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_ADD_KEY_CODES")).toEqual([
      "IN_ROSTER",
      "ALSO_IN_ROSTER",
    ]);
    expect(deriveRoster(fake, "KNOWN_OTHER_CODES")).toEqual(["IN_THE_OTHER_ONE"]);
  });

  it("SELF-TEST — the roster scan reads a Set whose `(` and `[` are on DIFFERENT lines", () => {
    // ⚠️ THIS IS THE SHAPE THAT MADE THE SCANNER RETURN [] AND PASS ANYWAY.
    // Reproduced structurally from `SubmitStep.tsx:230` — declared INSIDE a
    // function body (hence the eight-space indent), type annotation, the call's
    // `(` at end of line, the `[` on the next, and a close that carries a
    // trailing comma (`],` then `);`) because it is one argument of a
    // multi-line argument list rather than the whole call.
    //
    // The old two-character anchors (`"(["` / `"])"`) matched NONE of this and
    // derived the empty set. An empty roster makes "every emitted code is
    // admitted by that route's roster" fail LOUD, but an empty roster paired
    // with an empty emitter derivation — which is what a third ROUTES entry
    // would have had under the 400-only predicate — passes silently. Fixing the
    // scanner BEFORE the third entry lands is what makes that assertion
    // evidence rather than decoration.
    const fake = [
      "        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_FINALIZE_ROSTER",',
      '            "ALSO_IN_FINALIZE_ROSTER",',
      "          ],",
      "        );",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_FINALIZE_CODES")).toEqual([
      "IN_FINALIZE_ROSTER",
      "ALSO_IN_FINALIZE_ROSTER",
    ]);
  });

  it("SELF-TEST — the line-broken scan STOPS at its own close and does not swallow the next Set", () => {
    // The boundary guarantee, restated for the widened anchors. The old anchors
    // were two literal characters and could not over-run; regex anchors CAN, so
    // the first-match semantics are pinned here rather than assumed. If the
    // closing anchor ever became lazy across the wrong boundary, the first
    // roster would silently absorb the second's members and every membership
    // assertion in this file would go permissive.
    const fake = [
      "        const KNOWN_FINALIZE_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_FINALIZE_ROSTER",',
      "          ],",
      "        );",
      "",
      "        const KNOWN_LATER_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>(",
      "          [",
      '            "IN_THE_LATER_ONE",',
      "          ],",
      "        );",
    ].join("\n");
    expect(deriveRoster(fake, "KNOWN_FINALIZE_CODES")).toEqual([
      "IN_FINALIZE_ROSTER",
    ]);
    expect(deriveRoster(fake, "KNOWN_LATER_CODES")).toEqual(["IN_THE_LATER_ONE"]);
  });
});
